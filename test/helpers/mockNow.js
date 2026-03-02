export async function withMockedNow(isoString, fn) {
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        return new RealDate(isoString);
      }
      return new RealDate(...args);
    }

    static now() {
      return new RealDate(isoString).getTime();
    }

    static parse(value) {
      return RealDate.parse(value);
    }

    static UTC(...args) {
      return RealDate.UTC(...args);
    }
  }

  globalThis.Date = MockDate;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}
