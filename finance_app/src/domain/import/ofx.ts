import { makeDate, isValidDate } from '../dates';
import { parseMoney } from '../money';
import { ParsedStatement, ParsedTransaction, emptyStatement } from './types';
import { finaliseStatement, checkRunningBalances } from './csv';

/**
 * OFX / QFX reader. Handles both OFX 1.x (SGML, tags often left unclosed) and
 * OFX 2.x (XML). QFX is OFX with extra Intuit tags, which are ignored.
 *
 * A file can hold several statements (e.g. a bank account and a credit card);
 * each becomes its own ParsedStatement.
 */

interface Node {
  tag: string;
  text: string | null;
  children: Node[];
}

function tokenize(body: string): { type: 'open' | 'close'; tag: string; text: string }[] {
  const tokens: { type: 'open' | 'close'; tag: string; text: string }[] = [];
  const re = /<(\/?)([A-Za-z0-9_.]+)[^>]*>([^<]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    tokens.push({ type: m[1] ? 'close' : 'open', tag: m[2].toUpperCase(), text: m[3] });
  }
  return tokens;
}

/** Build a tree, treating an element with text and no explicit close tag as a leaf (SGML style). */
function buildTree(body: string): Node {
  const root: Node = { tag: 'ROOT', text: null, children: [] };
  const stack: Node[] = [root];
  for (const t of tokenize(body)) {
    if (t.type === 'open') {
      const node: Node = { tag: t.tag, text: null, children: [] };
      stack[stack.length - 1].children.push(node);
      const text = decodeEntities(t.text.trim());
      if (text) node.text = text; // leaf in SGML; may or may not have a close tag
      else stack.push(node);
    } else {
      // Close tag: pop to the matching open aggregate (ignore closes for leaves already handled).
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === t.tag) {
          stack.length = i;
          break;
        }
      }
    }
  }
  return root;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function findAll(node: Node, tag: string, out: Node[] = []): Node[] {
  for (const c of node.children) {
    if (c.tag === tag) out.push(c);
    findAll(c, tag, out);
  }
  return out;
}

function find(node: Node, tag: string): Node | undefined {
  for (const c of node.children) {
    if (c.tag === tag) return c;
    const f = find(c, tag);
    if (f) return f;
  }
  return undefined;
}

function val(node: Node | undefined, tag: string): string | null {
  if (!node) return null;
  const n = find(node, tag);
  return n?.text ?? null;
}

/** OFX dates look like 20260802, 20260802120000, 20260802120000.000[+10:AEST]. */
export function parseOfxDate(s: string | null): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const d = makeDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return isValidDate(d) ? d : null;
}

export function isOfx(text: string): boolean {
  const head = text.slice(0, 2000).toUpperCase();
  return head.includes('OFXHEADER') || head.includes('<OFX>') || head.includes('<?OFX');
}

export function parseOfx(text: string, format: 'ofx' | 'qfx' = 'ofx'): ParsedStatement[] {
  const start = text.search(/<OFX>/i);
  if (start < 0) throw new Error('This file does not contain OFX data.');
  const tree = buildTree(text.slice(start));
  const statements: ParsedStatement[] = [];

  const stmtNodes = [...findAll(tree, 'STMTRS'), ...findAll(tree, 'CCSTMTRS')];
  for (const s of stmtNodes) {
    const st = emptyStatement(format);
    const bankAcct = find(s, 'BANKACCTFROM');
    const ccAcct = find(s, 'CCACCTFROM');
    const acct = bankAcct ?? ccAcct;
    st.account = {
      number: val(acct, 'ACCTID'),
      bsb: val(acct, 'BRANCHID') ?? val(acct, 'BANKID'),
      type: ccAcct ? 'CREDITCARD' : val(acct, 'ACCTTYPE'),
      institution: val(tree, 'ORG'),
    };
    st.currency = val(s, 'CURDEF');
    const list = find(s, 'BANKTRANLIST');
    st.periodStart = parseOfxDate(val(list, 'DTSTART'));
    st.periodEnd = parseOfxDate(val(list, 'DTEND'));
    const ledger = find(s, 'LEDGERBAL');
    const closing = parseMoney(val(ledger, 'BALAMT') ?? '');
    if (closing) st.closingBalanceCents = closing.cents;

    const trns = list ? findAll(list, 'STMTTRN') : [];
    trns.forEach((t, i) => {
      const date = parseOfxDate(val(t, 'DTPOSTED'));
      const userDate = parseOfxDate(val(t, 'DTUSER'));
      const amt = parseMoney(val(t, 'TRNAMT') ?? '');
      const name = val(t, 'NAME') ?? val(t, 'PAYEE') ?? '';
      const memo = val(t, 'MEMO') ?? '';
      const raw: Record<string, string> = {};
      for (const c of t.children) if (c.text !== null) raw[c.tag] = c.text;
      if (!date || !amt) {
        st.rejectedRows.push({
          sourceRow: i + 1,
          reason: !date ? 'Transaction has no readable posted date' : 'Transaction has no readable amount',
          raw: JSON.stringify(raw),
        });
        return;
      }
      const description = [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' — ');
      const tx: ParsedTransaction = {
        sourceRow: i + 1,
        // DTUSER is when the purchase happened; DTPOSTED when the bank processed it.
        date: userDate ?? date,
        processingDate: userDate ? date : null,
        amountCents: amt.cents,
        description: description || (val(t, 'TRNTYPE') ?? 'Transaction'),
        payee: name || null,
        memo: memo || null,
        reference: val(t, 'CHECKNUM') ?? val(t, 'REFNUM'),
        externalId: val(t, 'FITID'),
        balanceCents: null,
        confidence: 'high',
        issues: [],
        raw,
      };
      if (!tx.externalId) {
        tx.issues.push('No transaction ID (FITID) — duplicate detection will rely on date, amount and description');
      }
      st.transactions.push(tx);
    });
    if (st.closingBalanceCents !== null && st.closingBalanceCents !== undefined && st.transactions.length) {
      // OFX gives the closing (ledger) balance; opening is implied.
      const movement = st.transactions.reduce((a, t) => a + t.amountCents, 0);
      st.openingBalanceCents = st.closingBalanceCents - movement;
      st.openingBalanceDerived = true;
      st.warnings.push('Opening balance is calculated from the closing balance and the transactions in the file (OFX files do not include it).');
    }
    checkRunningBalances(st.transactions);
    finaliseStatement(st);
    statements.push(st);
  }

  if (statements.length === 0) {
    const inv = findAll(tree, 'INVSTMTRS');
    if (inv.length) {
      throw new Error('This OFX file contains an investment statement. Import broker history from CSV/XLSX on the Investments screen instead.');
    }
    throw new Error('No bank or credit-card statement was found in this OFX file.');
  }
  return statements;
}
