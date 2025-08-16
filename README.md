# Euclid CLI Swap (schema v2)

CLI buat swap via Euclid API:
- Masukkan **Private Key** (di-prompt, tidak disimpan ke file)
- Pilih **chain asal**
- Pilih **token tujuan** (dari daftar global)
- Masukkan **amount** (dalam satuan koin native chain asal)
- Flow: routes → execute → broadcast (ethers) → track sekali (non-block) → intract-track (kredit ASTRA)

## Setup
```bash
npm i
cp .env.example .env
# edit .env kalau perlu (opsional AUTH_BEARER/API_COOKIE, delay looping, dll)
```

## Run
```bash
npm run cli
```

## Tambah Chain
Edit `config/chains.json` (schemaVersion=2). Tambahkan objek pada `chains[]`:
- `chain_uid`, `chain_id`, `native` (id/denom/decimals), `rpc_urls[]`, `explorer`
Daftar **token tujuan** dan **endpoint API** ada di `globals` jadi tidak perlu diulang per chain.
Jika perlu batasi token tujuan per chain, gunakan `dest_token_allow` (array id token).

## Catatan
- AUTH_BEARER/API_COOKIE opsional. Kosong pun jalan. Kalau poin ASTRA tiba-tiba seret, isi ulang dari Cookies.
- Saat ini input token diasumsikan **native**. Untuk ERC-20 sebagai input, tambahkan kebutuhanmu—script bisa diperluas.
