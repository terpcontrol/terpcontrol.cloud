/**
 * The brand's logo for a dark ground, as the share card draws it in its corner:
 * `webapp/public/assets/brand/logo-reverse.png` at 300 x 61 px, a palette PNG.
 *
 * It is carried in the code rather than read from a file, because the server's
 * image ships its compiled code and nothing beside it, and a card has to render
 * without the network. Made again after the logo changes with, in `server/`:
 * `node -e "require('sharp')('../webapp/public/assets/brand/logo-reverse.png').resize({ width: 300 }).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer().then(b => console.log(b.toString('base64')))"`
 */
export const BRAND_MARK = { width: 300, height: 61 } as const;

export const brandMarkPng = (): Buffer =>
  Buffer.from(
    [
      'iVBORw0KGgoAAAANSUhEUgAAASwAAAA9CAMAAAAgXqTNAAAAyVBMVEVMaXH////8/PtSrTf9/vv///9TrTXS4sP///////7///9Trjf////7/fr/////',
      '///////////////////////////////////+//3////////////////7/vpUsTj////////////////////////////9/v1VsTn///9Trzj/////////',
      '//////////9VsDr///9WsjtXsjz///9XszxXsz1UsThRrjdVsTm76J+/7KPH8aus4JH///9WtDpZuTtbvj2BzWSo4YyMXB31AAAAPXRSTlMAshH9AgYG',
      'AfsD39fJDPbZ0ajru+Qn/sIWSXlSoTCzZHEhNZhbhELC8eZrkH87GpaKNkced1vzG6m20YtuDqHX2QAAAAlwSFlzAAAD6AAAA+gBtXtSawAAEDdJREFU',
      'eNrtW4ty4kiyTQnJQljoDRIgmjfGvIzBdvfcu8Ke+f+P2pNVemJ65m5stCNu0BXRbShKJeoo82TmqYKo0kxN/FGHg/5MsZxwZTe7adNehY7lHUa7vYEP',
      'NdOg340IKLSno5nld9O8ddGKN761GcQlprfd9JHSEtB0m7ZtN5vNDKcuXtpsZGk39ZW5SsYNG5fJzTBpkTYZpwIkfrMSrigbIwa8wkVMt4qWIZ1K08hK',
      'm9Lp7FaULNaD3bAzQesMl4P1QXFtAJUKe3PbQOsWzQtYTRfepmeatAFYqe31e532Nfs79RaRLcwt7ZFuskXeHFptJU0tO3U71A7gh/aEYGqGqQvn1LjJ',
      'V2LwZB0xoB2MgSmSdmPWZQTOKt36qevuqbMCWn3SNaOeHxhm1rh3mkQDMnqe6yqDW/PFUZpsrLkSbNMZUZLaqQKrASPpels0vYKbZoosyyBtlorYmOi3',
      'RfVWmi7IpDnSqBjINVMXWNDAdZ2sua4VKcmmP9/FIgzAK+nAoHr4b0M3lXPZijIlnWJPWe1oALAcsPtklZa5aJmUBgONyYo6NhKuvRoiNg5vCi07CnYA',
      'ax8E9hT2BbB0g6acIlSabYuktJtGHY6BYwwbkYB2S7cUEqM03SCojdI0jKmP5UfMWco1ywJq6QpZA3KM1DKQcwRpmtwUWPN0Nmv1oqAP/iEFNDQjkHh7',
      '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',
    ].join(''),
    'base64',
  );
