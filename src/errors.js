export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (m) => new HttpError(400, m);
export const forbidden = (m) => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
