Join information Airdrop : https://t.me/AirdropShogun

TUTORIAL 

Make screen 
```bash 
screen -S euclidbot
```
clone repository
```bash
git clone https://github.com/fahminurd93/astra-farming-euclid
cd astra-farming-euclid
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


For Coffe : 0xf38B5a06544eb35Bf49CB6917430274f6e615Be7
