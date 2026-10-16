import { XMLParser } from 'fast-xml-parser';

export type ParsedInvoice = {
  issuedDate: string;
  deliveryDate: string;
  supplier: {
    idno: string;
    title: string;
    address: string;
    vatNumber: string;
    bankAccount: { branchTitle: string; branchCode: string; account: string };
  };
  buyer: {
    idno: string;
    title: string;
    address: string;
    vatNumber: string;
    bankAccount: { branchTitle: string; branchCode: string; account: string };
  };
  notes: string;
  delegate: { seria: string; number: string; name: string; date: string };
  vehicleLogbook: { number: string; date: string };
  loadingPoint: string;
  unloadingPoint: string;
  total: number;
  totalTVA: number;
  merchandises: Array<{
    code: string;
    name: string;
    unitOfMeasure: string;
    quantity: number;
    unitPriceWithoutTVA: number;
    totalPriceWithoutTVA: number;
    tva: number;
    totalTVA: number;
    totalPrice: number;
  }>;
};

const emptyInvoice = (): ParsedInvoice => ({
  issuedDate: '',
  deliveryDate: '',
  supplier: {
    idno: '',
    title: '',
    address: '',
    vatNumber: '',
    bankAccount: { branchTitle: '', branchCode: '', account: '' },
  },
  buyer: {
    idno: '',
    title: '',
    address: '',
    vatNumber: '',
    bankAccount: { branchTitle: '', branchCode: '', account: '' },
  },
  notes: '',
  delegate: { seria: '', number: '', name: '', date: '' },
  vehicleLogbook: { number: '', date: '' },
  loadingPoint: '',
  unloadingPoint: '',
  total: 0,
  totalTVA: 0,
  merchandises: [],
});

const decodeEntities = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const unwrapCdata = (xml: string): string => {
  const m = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1]! : xml;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

const asArray = <T>(v: T | T[] | undefined): T[] => {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
};

const partyFrom = (node: Record<string, unknown> | undefined) => {
  if (!node) {
    return {
      idno: '',
      title: '',
      address: '',
      vatNumber: '',
      bankAccount: { branchTitle: '', branchCode: '', account: '' },
    };
  }
  const ba = (node.BankAccount as Record<string, unknown> | undefined) ?? {};
  return {
    idno: String(node['@_IDNO'] ?? ''),
    title: decodeEntities(String(node['@_Title'] ?? '')),
    address: decodeEntities(String(node['@_Address'] ?? '')),
    vatNumber: String(node['@_CodTVA'] ?? '').trim(),
    bankAccount: {
      branchTitle: decodeEntities(String(ba['@_BranchTitle'] ?? '')),
      branchCode: String(ba['@_BranchCode'] ?? ''),
      account: String(ba['@_Account'] ?? ''),
    },
  };
};

export const parseInvoiceXml = (raw: string): ParsedInvoice => {
  let xml = unwrapCdata(raw);
  xml = decodeEntities(xml);

  try {
    const parsed = parser.parse(xml);
    const root = parsed.Document ?? parsed;
    const si = (root.SupplierInfo ?? root) as Record<string, unknown>;
    const rows = asArray((si.Merchandises as { Row?: unknown })?.Row as Record<string, unknown>);
    const vl = (si.VehicleLogbook as Record<string, unknown> | undefined) ?? {};

    return {
      issuedDate: String(si.IssuedDate ?? ''),
      deliveryDate: String(si.DeliveryDate ?? ''),
      supplier: partyFrom(si.Supplier as Record<string, unknown>),
      buyer: partyFrom(si.Buyer as Record<string, unknown>),
      notes: decodeEntities(String(si.Notes ?? '')),
      delegate: {
        seria: String(si.DelegateSeria ?? ''),
        number: String(si.DelegateNumber ?? ''),
        name: decodeEntities(String(si.DelegateName ?? '')),
        date: String(si.DelegateDate ?? ''),
      },
      vehicleLogbook: {
        number: String(vl.Number ?? ''),
        date: String(vl.IssuedDate ?? ''),
      },
      loadingPoint: decodeEntities(String(si.LoadingPoint ?? '')),
      unloadingPoint: decodeEntities(String(si.UnloadingPoint ?? '')),
      total: Number(si.Total ?? 0),
      totalTVA: Number(si.TotalTVA ?? 0),
      merchandises: rows.map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          code: String(row['@_Code'] ?? ''),
          name: decodeEntities(String(row['@_Name'] ?? '')),
          unitOfMeasure: String(row['@_UnitOfMeasure'] ?? ''),
          quantity: Number(row['@_Quantity'] ?? 0),
          unitPriceWithoutTVA: Number(row['@_UnitPriceWithoutTVA'] ?? 0),
          totalPriceWithoutTVA: Number(row['@_TotalPriceWithoutTVA'] ?? 0),
          tva: Number(row['@_TVA'] ?? 0),
          totalTVA: Number(row['@_TotalTVA'] ?? 0),
          totalPrice: Number(row['@_TotalPrice'] ?? 0),
        };
      }),
    };
  } catch {
    return emptyInvoice();
  }
};
