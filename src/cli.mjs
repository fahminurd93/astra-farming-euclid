// src/cli.mjs — Euclid CLI Swap (FAST mode: non-blocking credit, JSONC config, lean logs)
//
// .env minimal:
//   PRIVATE_KEY=0x....
//   (opsional) SENDER=0x...
//
// Saran cepat:
//   DELAY_MS=3000
//   AMOUNT_JITTER_PCT=0
//
// Yang lain opsional aja.

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { ethers } from 'ethers';
import inquirer from 'inquirer';
import { fileURLToPath } from 'url';

/* ---------- util ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const env   = (k,d=undefined) => (process.env[k] ?? d);

function box(lines=[]) {
  const width = 76;
  const border = '='.repeat(width);
  console.log(border);
  console.log('');
  for (const ln of lines) console.log(ln);
  console.log('');
  console.log(border);
}

function showHeader() {
  try {
    const p = path.join(ROOT, 'shogun.txt');
    if (fs.existsSync(p)) console.log(fs.readFileSync(p, 'utf8'));
  } catch {}
}

/* ---------- ENV ---------- */
const PRIVATE_KEY = (env('PRIVATE_KEY','') || '').trim();
if (!PRIVATE_KEY) {
  console.error('❌ PRIVATE_KEY kosong di .env. Isi dulu ya.');
  process.exit(1);
}
const SENDER            = (env('SENDER','') || '').trim(); // opsional
const DELAY_MS          = parseInt(env('DELAY_MS','3000'), 10);
const AMOUNT_JITTER_PCT = parseFloat(env('AMOUNT_JITTER_PCT','0') || '0');

const EXECUTE_URL = env('EXECUTE_URL','https://testnet.api.euclidprotocol.com/api/v1/execute/astro/swap');
const ROUTES_URL  = env('ROUTES_URL','https://testnet.api.euclidprotocol.com/api/v1/routes?limit=10');
const TRACK_URL   = env('TRACK_URL','https://testnet.api.euclidprotocol.com/api/v1/txn/track/swap');
const INTRACT_URL = env('INTRACT_URL','https://testnet.euclidswap.io/api/intract-track');

const AUTH_BEARER = env('AUTH_BEARER',''); // opsional
const API_COOKIE  = env('API_COOKIE','');  // opsional

const SLIPPAGE_BPS    = env('SLIPPAGE_BPS','500');
const PARTNER_FEE_BPS = env('PARTNER_FEE_BPS','10');

/* ---------- HTTP (browsery headers) ---------- */
const BASE_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'content-type': 'application/json',
  'origin': 'https://testnet.euclidswap.io',
  'referer': 'https://testnet.euclidswap.io/swap',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Not)A;Brand";v="99", "Chromium";v="138", "Google Chrome";v="138"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
  'priority': 'u=1, i',
  'connection': 'keep-alive'
};
const withSession = (extra={}) => {
  const out = { ...BASE_HEADERS, ...extra };
  if (API_COOKIE)  out['cookie'] = API_COOKIE;
  if (AUTH_BEARER) out['authorization'] = `Bearer ${AUTH_BEARER}`;
  return out;
};
const httpRoutes  = axios.create({ timeout: 20000, headers: withSession({}) });
const httpExec    = axios.create({ timeout: 20000, headers: withSession({}) });
const httpTrack   = axios.create({ timeout: 10000, headers: withSession({ 'referer': 'https://testnet.euclidswap.io/swap' }) });
const httpIntract = axios.create({ timeout: 10000, headers: withSession({ 'x-app-version': '2.0.0', 'referer':'https://testnet.euclidswap.io/' }) });

/* ---------- config loader (JSON with comments) ---------- */
const cfgPath = path.resolve(__dirname, '..', 'config', 'chains.json');
function loadJsonSafe(p) {
  let raw = fs.readFileSync(p, 'utf8');
  raw = raw.replace(/^\uFEFF/, '')
           .replace(/\/\*[\s\S]*?\*\//g, '') // /* ... */
           .replace(/^\s*\/\/.*$/gm, '')     // // ...
           .replace(/^\s*#.*$/gm, '')        // # ...
           .replace(/,\s*([}\]])/g, '$1');   // trailing comma
  return JSON.parse(raw);
}
if (!fs.existsSync(cfgPath)) { console.error('❌ config/chains.json tidak ditemukan'); process.exit(1); }
const CFG     = loadJsonSafe(cfgPath);
const CHAINS  = CFG.chains || [];
const GLOBALS = CFG.globals || {};
if (!CHAINS.length) { console.error('❌ chains kosong'); process.exit(1); }

const destinationTokenList = (chain) => {
  let dest = (GLOBALS.destination_tokens || []).slice();
  const allow = chain.dest_token_allow;
  if (Array.isArray(allow) && allow.length) {
    const s = new Set(allow.map(x=>x.toLowerCase()));
    dest = dest.filter(t => s.has(t.id.toLowerCase()));
  }
  return dest;
};
const nativeToken = (chain) => {
  const t = chain.native; if (!t) throw new Error(`native token tidak ada untuk ${chain.chain_uid}`); return t;
};

/* ---------- single-RPC retry ringan ---------- */
function makeProvider(url) { return new ethers.JsonRpcProvider(url); }
async function rpcTry(url, op) {
  let provider = makeProvider(url);
  let delay = 900;
  for (let i=0; i<3; i++) {
    try { return await op(provider); }
    catch (e) {
      const msg = (e?.info?.responseStatus || e?.code || e?.message || '').toString().toLowerCase();
      const retriable = msg.includes('504') || msg.includes('timeout') || msg.includes('gateway') ||
                        msg.includes('socket') || msg.includes('temporarily') || msg.includes('429') ||
                        msg.includes('busy') || msg.includes('fetch failed');
      if (!retriable || i === 2) throw e;
      provider = makeProvider(url);
      await sleep(delay);
      delay = Math.ceil(delay * 1.3);
    }
  }
}

/* ---------- API helpers ---------- */
async function fetchRoutes({ amountWei, tokenIn, tokenOut }) {
  const body = { external: true, token_in: tokenIn, token_out: tokenOut, amount_in: String(amountWei), chain_uids: [] };
  const { data } = await httpRoutes.post(ROUTES_URL, body);
  if (!data?.paths?.[0]?.path?.length) throw new Error('routes: path kosong');
  const top = data.paths[0];
  return {
    swap_path: {
      path: top.path.map(h => ({ route: h.route, dex: h.dex, chain_uid: h.chain_uid, amount_in: h.amount_in, amount_out: h.amount_out })),
      total_price_impact: top.total_price_impact
    }
  };
}
async function executeSwap(payload) {
  try { const { data } = await httpExec.post(EXECUTE_URL, payload); return data; }
  catch (e) {
    const code = e?.response?.status;
    if (code >= 500 && code < 600) {
      await sleep(800);
      const { data } = await httpExec.post(EXECUTE_URL, payload);
      return data;
    }
    throw e;
  }
}

/* ---------- credit fire-and-forget (NGAWAIT) ---------- */
function creditNonBlocking({ chain_uid, tx_hash, wallet_address }) {
  // 1) langsung tembak TRACK
  httpTrack.post(TRACK_URL, { chain: chain_uid, tx_hash }).catch(()=>{});

  // 2) jadwalkan INTRACT (2x) + TRACK ulang — tanpa nahan loop
  setTimeout(() => {
    httpIntract.post(INTRACT_URL, { chain_uid, tx_hash, wallet_address, type: 'swap' }).catch(()=>{});
  }, 800);

  setTimeout(() => {
    httpIntract.post(INTRACT_URL, { chain_uid, tx_hash, wallet_address, type: 'swap' }).catch(()=>{});
    httpTrack.post(TRACK_URL, { chain: chain_uid, tx_hash }).catch(()=>{});
  }, 2000);
}

/* ---------- prompt sekali ---------- */
async function promptSelections() {
  const { srcUid } = await inquirer.prompt([{
    name: 'srcUid', type: 'list', message: 'Swap dari chain:',
    choices: CHAINS.map(c => ({ name: `${c.name} (${c.chain_uid})`, value: c.chain_uid }))
  }]);
  const chain = CHAINS.find(c => c.chain_uid === srcUid);
  const destList = destinationTokenList(chain);
  const { tokenOutId } = await inquirer.prompt([{
    name: 'tokenOutId', type: 'list', message: 'Token tujuan:',
    choices: destList.map(t => ({ name: t.display || t.id.toUpperCase(), value: t.id }))
  }]);
  const nat = nativeToken(chain);
  const { amountHuman } = await inquirer.prompt([{
    name: 'amountHuman', type: 'input',
    message: `Jumlah ${nat.display || nat.id.toUpperCase()} (contoh: 1000):`,
    validate: (v) => isFinite(Number(v)) && Number(v) > 0 ? true : 'Masukkan angka > 0'
  }]);
  return { chain, tokenOutId, amountHuman: String(amountHuman) };
}

/* ---------- satu swap ---------- */
async function doOneSwap({ chain, tokenOutId, amountHuman, wallet, creditWallet }) {
  const rpcUrl = (chain.rpc_urls || [])[0];
  if (!rpcUrl) throw new Error(`rpc_urls kosong untuk ${chain.chain_uid}`);

  const tIn  = nativeToken(chain);
  const tOut = destinationTokenList(chain).find(t => t.id === tokenOutId);
  if (!tOut) throw new Error(`token tujuan ${tokenOutId} tidak tersedia`);

  // jitter off / optional
  let amtHuman = Number(amountHuman);
  if (AMOUNT_JITTER_PCT > 0) {
    const delta = (Math.random()*2 - 1) * (AMOUNT_JITTER_PCT/100) * amtHuman;
    amtHuman = Math.max(0, Math.round((amtHuman + delta) * 1e6)/1e6);
  }
  const amountWei = ethers.parseUnits(String(amtHuman), tIn.decimals ?? 18);

  // Notif mulai
  box([ `Sedang Melakukan Swap (${amtHuman} ${tIn.display || tIn.id.toUpperCase()} → ${tOut.display || tOut.id.toUpperCase()})` ]);

  // 1) routes
  const { swap_path } = await fetchRoutes({ amountWei, tokenIn: tIn.id, tokenOut: tOut.id });

  // 2) execute
  const payload = {
    amount_in: amountWei.toString(),
    asset_in: {
      token: tIn.id,
      token_type: { "__typename":"NativeTokenType", native: { "__typename":"NativeToken", denom: tIn.denom || tIn.id } }
    },
    slippage: String(SLIPPAGE_BPS),
    partnerFee: String(PARTNER_FEE_BPS),
    sender: { address: wallet.address, chain_uid: chain.chain_uid },
    cross_chain_addresses: [{ user: { address: wallet.address, chain_uid: chain.chain_uid } }],
    swap_path
  };
  const exec = await executeSwap(payload);
  const m = exec?.msgs?.[0];
  if (!m) throw new Error('execute: msgs kosong');

  // 3) broadcast (dengan retry ringan)
  const txReq = { to: m.to, data: m.data, value: m.value ?? undefined, chainId: m.chainId ? Number(m.chainId) : undefined };

  try {
    await rpcTry(rpcUrl, async (prov) => {
      const gas = await prov.estimateGas({ from: wallet.address, ...txReq });
      txReq.gasLimit = gas;
    });
  } catch { /* skip */ }

  let sent, rcpt;
  try {
    sent = await rpcTry(rpcUrl, async (prov) => await wallet.connect(prov).sendTransaction(txReq));
    rcpt = await rpcTry(rpcUrl, async (prov) => await prov.waitForTransaction(sent.hash));
  } catch (e) {
    const emsg = (e?.info?.error?.message || e?.message || '').toLowerCase();
    if (emsg.includes('insufficient funds')) {
      box([ 'Gagal Swap: Balancemu Tidak Cukup Bro' ]);
      return null;
    }
    box([ `Gagal Swap: ${e?.info?.responseStatus || e?.code || e?.message || 'unknown'}`, '', 'Coba Ulang lagi ya..!!!' ]);
    return null;
  }

  const txHash = sent.hash;

  // 4) Kredit ASTRA — non-blocking; biar poin nyusul
  creditNonBlocking({ chain_uid: chain.chain_uid, tx_hash: txHash, wallet_address: creditWallet });

  // 5) notif sukses
  box([
    '✅  Sukses Bro, Astra Point akan segera Masuk',
    '',
    `Tx: ${txHash}`,
    '',
    'Lanjut lagi, Jangan lupa gabung t.me/airdropshogun'
  ]);

  return txHash;
}

/* ---------- main ---------- */
(async () => {
  showHeader();

  // wallet + alamat kredit
  let wallet;
  try { wallet = new ethers.Wallet(PRIVATE_KEY); }
  catch { console.error('❌ PRIVATE_KEY invalid.'); process.exit(1); }
  const creditWallet = (SENDER ? ethers.getAddress(SENDER) : ethers.getAddress(wallet.address)).toLowerCase();

  // pilih sekali
  const { chain, tokenOutId, amountHuman } = await promptSelections();

  while (true) {
    try { await doOneSwap({ chain, tokenOutId, amountHuman, wallet, creditWallet }); }
    catch (e) {
      box([ `Gagal Swap: ${e?.response?.data?.error || e?.message || 'unknown error'}`, '', 'Coba Ulang lagi ya..!!!' ]);
    }
    await sleep(DELAY_MS);
  }
})().catch(e => { console.error('❌ ERROR:', e?.message || e); process.exit(1); });
