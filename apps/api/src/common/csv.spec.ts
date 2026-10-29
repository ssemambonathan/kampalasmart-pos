import { csvEscape, parseCsv, toCsv } from './csv';

describe('csvEscape', () => {
  it('neutralises formula prefixes from exported text', () => {
    expect(csvEscape('=1+1')).toBe("'=1+1");
    expect(csvEscape('+SUM(A1:A2)')).toBe("'+SUM(A1:A2)");
    expect(csvEscape('@cmd')).toBe("'@cmd");
    expect(csvEscape('-1+2')).toBe("'-1+2");
  });

  it('keeps ordinary negative amounts and quotes separators', () => {
    expect(csvEscape('-1250.00')).toBe('-1250.00');
    expect(csvEscape('Mirembe, Main')).toBe('"Mirembe, Main"');
    expect(csvEscape('say "hello"')).toBe('"say ""hello"""');
    expect(csvEscape(null)).toBe('');
  });

  it('round-trips a document through the parser', () => {
    const document = toCsv(['name', 'amount'], [['Coke, 500ml', '-5000.00']]);
    expect(parseCsv(document)).toEqual([
      ['name', 'amount'],
      ['Coke, 500ml', '-5000.00'],
    ]);
  });
});
