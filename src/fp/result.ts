/**
 * Red Book–style Either for fallible work.
 * Left = failure, Right = success. Prefer returning values over throwing.
 */
export type Left<E> = { readonly _tag: 'Left'; readonly left: E };
export type Right<A> = { readonly _tag: 'Right'; readonly right: A };
export type Either<E, A> = Left<E> | Right<A>;

export const left = <E, A = never>(e: E): Either<E, A> => ({ _tag: 'Left', left: e });
export const right = <A, E = never>(a: A): Either<E, A> => ({ _tag: 'Right', right: a });

export const isLeft = <E, A>(e: Either<E, A>): e is Left<E> => e._tag === 'Left';
export const isRight = <E, A>(e: Either<E, A>): e is Right<A> => e._tag === 'Right';

export const map =
  <E, A, B>(f: (a: A) => B) =>
  (e: Either<E, A>): Either<E, B> =>
    isRight(e) ? right(f(e.right)) : e;

export const flatMap =
  <E, A, B>(f: (a: A) => Either<E, B>) =>
  (e: Either<E, A>): Either<E, B> =>
    isRight(e) ? f(e.right) : e;

export const mapLeft =
  <E, F, A>(f: (e: E) => F) =>
  (e: Either<E, A>): Either<F, A> =>
    isLeft(e) ? left(f(e.left)) : e;

export const getOrElse =
  <E, A>(onLeft: (e: E) => A) =>
  (e: Either<E, A>): A =>
    isRight(e) ? e.right : onLeft(e.left);

export const fold =
  <E, A, B>(onLeft: (e: E) => B, onRight: (a: A) => B) =>
  (e: Either<E, A>): B =>
    isLeft(e) ? onLeft(e.left) : onRight(e.right);
