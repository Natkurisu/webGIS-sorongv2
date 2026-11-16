# WebGIS Asap Karhutla Kabupaten Sorong, 1–11 Oktober 2026

PjBL SIG GD4103, K-02 Kelompok 6. Situs statis untuk GitHub Pages: menampilkan raster sebaran asap hasil HYSPLIT dan menumpangkannya dengan data fasilitas. **Tidak ada pemodelan di situs ini**; modelnya dijalankan lebih dulu dan hasilnya disimpan sebagai berkas di folder `data`.

## Isi folder

| Berkas | Fungsi |
|---|---|
| `index.html` | Susunan halaman: ringkasan angka, peta, tabel overlay, grafik, penjelasan |
| `css/style.css` | Tampilan |
| `js/app.js` | Seluruh logika (sekitar 300 baris, berkomentar) |
| `lib/` | Leaflet 1.9.4 dan Chart.js 4, disertakan agar tidak bergantung pada CDN |
| `data/meta.json` | Keterangan raster: cakupan, ukuran grid, daftar waktu, ambang kelas, jumlah titik panas per hari |
| `data/asap_3jam.bin` | Raster indeks asap: 88 langkah (3 jam) × 61 baris × 71 kolom, bilangan float32 |
| `data/fasilitas.geojson` | Titik fasilitas di Kabupaten Sorong (OpenStreetMap) |
| `data/titik_panas.json` | Titik panas VIIRS 1–11 Oktober: `[bujur, lintang, tanggal, FRP, wilayah]` |
| `data/batas_kab_sorong.geojson`, `data/batas_sekitar.geojson` | Batas wilayah |
| `data/unduh/*.tif` | Raster yang sama dalam GeoTIFF, untuk diunduh dan dibuka di QGIS |

## Cara kerja `app.js`

1. **Memuat data.** Enam berkas di `data/` diambil sekaligus. `asap_3jam.bin` dibaca sebagai satu deret angka panjang; nilai sel pada waktu `t`, baris `b`, kolom `k` berada di posisi `t × (nx × ny) + b × nx + k`. Baris 0 adalah yang paling utara.
2. **Memilih waktu.** Mode "per 3 jam" mengambil satu potong deret itu. Mode "harian" merata-ratakan 8 potong berurutan (8 × 3 jam = 24 jam). Karena data model memakai UTC dan WIT = UTC + 9, satu "hari" di sini berjalan dari pukul 09.00 WIT sampai 09.00 WIT hari berikutnya.
3. **Menggambar raster.** Setiap sel diubah menjadi kelas (fungsi `kelasDari`) memakai tiga ambang di `meta.json`, diwarnai, dan ditempel di peta sebagai gambar.
4. **Overlay.** Untuk tiap fasilitas dihitung sel tempatnya berada dari bujur dan lintangnya (fungsi `siapkanFasilitas`). Fungsi `overlay` lalu membaca nilai sel itu di semua waktu: fasilitas "terdampak" bila kelasnya mencapai kelas yang dipilih. Dari situ diperoleh lama terdampak (jumlah langkah × 3 jam) dan waktu pertama terdampak.
5. **Tabel dan grafik.** Hasil overlay ditampilkan sebagai tabel yang bisa disaring dan diunduh, dan sebagai grafik jumlah fasilitas terdampak per hari.

## Dari mana rasternya

Seluruh masukan, keluaran, dan skrip ada di folder `hasil_model` (di luar folder situs).

1. Titik panas VIIRS NOAA-20/21 diunduh dari NASA FIRMS, disaring pada *confidence* nominal dan tinggi (`skrip/sumber.py`).
2. Titik panas dikelompokkan per wilayah dan per sel 0,1°; FRP harian tiap sel menjadi laju emisi relatif (`skrip/siap_hysplit.py` menulis `CONTROL`, `SETUP.CFG`, dan `EMITIMES` untuk tiap kelompok).
3. HYSPLIT v5.4.2 dijalankan per kelompok dengan meteorologi GDAS1, 30 September–11 Oktober 2026, rilis di 300 m, keluaran rata-rata 3 jam pada lapisan 0–100 m (`hysplit/run_*/cdump`).
4. Keluaran semua kelompok dijumlahkan, dibagi persentil ke-99 agar menjadi indeks 0–1, lalu ditulis ke `asap_3jam.bin` dan GeoTIFF (`skrip/gabung2.py`). Ambang kelas adalah persentil ke-50, 75, dan 90 dari nilai indeks.

Pengaturan yang dipilih agar model selesai dalam waktu singkat, dan perlu disebut sebagai keterbatasan: langkah waktu 20 menit, umur partikel maksimum 48 jam, 2.000–5.000 partikel per hari per kelompok.

## Memasang di GitHub Pages

1. Buat repositori publik, unggah **isi** folder ini (bukan foldernya) lewat "uploading an existing file".
2. Settings → Pages → "Deploy from a branch", cabang `main`, folder `/ (root)`.
3. Situs tampil di `https://<nama-pengguna>.github.io/<nama-repo>/` setelah satu sampai dua menit.

Mencoba di komputer sendiri: jalankan `python -m http.server` di folder ini, lalu buka `http://localhost:8000`.

## Yang belum ada

Validasi terhadap AOD atau PM2,5, skenario tinggi injeksi lain, faktor gambut, dan fasilitas berbentuk garis (jalan). Layer citra NASA GIBS belum diuji.
