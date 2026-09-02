export interface Clock {
  now(): Date;
}

export interface UuidV7Generator {
  next(): string;
}
