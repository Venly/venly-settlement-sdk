import { readFileSync, writeFileSync } from 'fs';

const fpath = './src/mock/finance.ts';
let content = readFileSync(fpath, 'utf-8');
const lines = content.split('\n');

// exact verified values from JSON.stringify:
// 604 (idx 603): 5 spaces + "POST..."
// 605 (idx 604): 6 spaces + kind...
// 606 (idx 605): 6 spaces + result...
// 607 (idx 606): 2 spaces + },

const old = lines[603] + '\n' + lines[604] + '\n' + lines[605] + '\n' + lines[606];

const newLines =
   '     "POST /accounts/{accountId}/fiat-to-crypto/payment-sessions": {\n' +
   '      kind: "handler",\n' +
   '      handle: (ctx) => itemEnvelope(store.createPaymentSession(ctx)),\n' +
   '    },';

const oldContent = content;
content = content.replace(old, newLines);
if (content === oldContent) {
  console.error('ERROR: no match');
  process.exit(1);
}

writeFileSync(fpath, content);
console.log('OK');
