import { escapeXml } from '../soap/envelope.js';
import type { PostInvoiceInput } from '../domain/types.js';

type Document = PostInvoiceInput['documents'][number];

const attr = (name: string, value: string | number): string =>
  `${name}="${escapeXml(String(value))}"`;

const buildDocument = (doc: Document): string => {
  const supplierAttrs = [
    attr('IDNO', doc.supplier.idno),
    attr('Title', doc.supplier.title),
    attr('Address', doc.supplier.address),
    doc.supplier.taxpayer_type != null ? attr('TaxpayerType', doc.supplier.taxpayer_type) : '',
    doc.supplier.vat_number != null ? attr('CodTVA', doc.supplier.vat_number) : '',
  ]
    .filter(Boolean)
    .join(' ');

  const buyerAttrs = [
    attr('IDNO', doc.buyer.idno),
    attr('Title', doc.buyer.title),
    attr('Address', doc.buyer.address),
    doc.buyer.taxpayer_type != null ? attr('TaxpayerType', doc.buyer.taxpayer_type) : '',
    doc.buyer.vat_number != null ? attr('CodTVA', doc.buyer.vat_number) : '',
  ]
    .filter(Boolean)
    .join(' ');

  const rows = doc.merchandises
    .map(
      (m) =>
        `<Row ${attr('Code', m.code)} ${attr('Name', m.name)} ${attr('UnitOfMeasure', m.unit_of_measure)} ${attr('Quantity', m.quantity)} ${attr('UnitPriceWithoutTVA', m.unit_price_without_tva)} ${attr('TotalPriceWithoutTVA', m.total_price_without_tva)} ${attr('TVA', m.tva)} ${attr('TotalTVA', m.total_tva)} ${attr('TotalPrice', m.total_price)} />`,
    )
    .join('');

  const redirections =
    doc.creation_motiv === 5 ? '<Redirections>Non-Livrare</Redirections>' : '';
  const notes = doc.notes != null ? `<Notes>${escapeXml(doc.notes)}</Notes>` : '';

  let additional = '';
  if (doc.additional_information) {
    const id = doc.additional_information.id
      ? `<id>${escapeXml(doc.additional_information.id)}</id>`
      : '';
    const files = (doc.additional_information.attachments ?? [])
      .map(
        (a) =>
          `<FileContent>${a.base64encoded}</FileContent><FileName>${escapeXml(a.name)}</FileName>`,
      )
      .join('');
    additional = `<AdditionalInformation>${id}${files}</AdditionalInformation>`;
  }

  return `<Document>
  <SupplierInfo>
    <DeliveryDate>${escapeXml(doc.delivery_date)}</DeliveryDate>
    <Supplier ${supplierAttrs}>
      <BankAccount ${attr('BranchTitle', doc.supplier.bank_account.branch_title)} ${attr('BranchCode', doc.supplier.bank_account.branch_code)} ${attr('Account', doc.supplier.bank_account.account)} />
    </Supplier>
    <Buyer ${buyerAttrs}>
      <BankAccount ${attr('BranchTitle', doc.buyer.bank_account.branch_title)} ${attr('BranchCode', doc.buyer.bank_account.branch_code)} ${attr('Account', doc.buyer.bank_account.account)} />
    </Buyer>
    ${redirections}
    <Merchandises>${rows}</Merchandises>
    ${notes}
    <CreationMotiv>${doc.creation_motiv}</CreationMotiv>
  </SupplierInfo>
  ${additional}
</Document>`;
};

export const buildInvoicesXml = (documents: readonly Document[]): string =>
  `<?xml version="1.0"?><Documents>${documents.map(buildDocument).join('')}</Documents>`;

export const hasAttachments = (documents: readonly Document[]): boolean =>
  documents.some((d) => (d.additional_information?.attachments?.length ?? 0) > 0);

/** Prefer first document external id as natural idempotency key. */
export const extractExternalIds = (documents: readonly Document[]): string[] =>
  documents
    .map((d) => d.additional_information?.id?.trim())
    .filter((id): id is string => Boolean(id));
