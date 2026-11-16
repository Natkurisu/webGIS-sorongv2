/* WebGIS Asap Karhutla Kabupaten Sorong
   ------------------------------------------------------------------
   Berkas ini hanya melakukan empat hal:
     1. memuat data (raster asap, fasilitas, titik panas, batas wilayah);
     2. menggambar raster asap pada waktu terpilih di atas peta Leaflet;
     3. overlay: membaca nilai raster di lokasi tiap fasilitas, lalu menentukan terdampak atau tidak;
     4. menampilkan hasilnya sebagai tabel dan grafik.
   Tidak ada pemodelan di sini. Raster asap sudah dihitung sebelumnya dengan HYSPLIT.
   ------------------------------------------------------------------ */

const WARNA = ["#f1dfa6", "#e0a458", "#b5562b", "#5b2a3c"];           // warna empat kelas asap
const KELAS = ["Rendah", "Sedang", "Tinggi", "Sangat tinggi"];
const JENIS = { faskes: "Fasilitas kesehatan", sekolah: "Sekolah", bandara: "Bandara", pelabuhan: "Pelabuhan",
                ibadah: "Tempat ibadah", kantor: "Kantor pemerintahan", jalan: "Jalan utama", utilitas: "Listrik dan air" };
const WARNA_JENIS = { faskes: "#b5562b", sekolah: "#0f6b5c", pelabuhan: "#3b4cc0", ibadah: "#c98a00", kantor: "#5b2a3c", bandara: "#51655f" };
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const el = (id) => document.getElementById(id);

let meta, asap;            // meta.json dan nilai raster per 3 jam (Float32Array)
let fasilitas = [];        // daftar fasilitas beserta hasil overlay
let titikPanas = [];       // [bujur, lintang, tanggal, FRP, wilayah]
let mode = "harian";       // "harian" atau "3jam"
let indeksWaktu = 0;       // langkah waktu yang sedang tampil
let ambang = 2;            // kelas minimal agar dihitung terdampak (2 = Tinggi)
let peta, lapisAsap, lapisFas, lapisTitik, lapisBatas, lapisSekitar, kanvas, petaDasar = {}, pemutar = null;
let grafikFas, grafikTitik;

/* ---------- 1. MEMUAT DATA ---------- */
const ambil = (nama) => fetch("data/" + nama).then((r) => { if (!r.ok) throw new Error(nama + " tidak ditemukan"); return r; });
Promise.all([
  ambil("meta.json").then((r) => r.json()),
  ambil("asap_3jam.bin").then((r) => r.arrayBuffer()),
  ambil("fasilitas.geojson").then((r) => r.json()),
  ambil("titik_panas.json").then((r) => r.json()),
  ambil("batas_kab_sorong.geojson").then((r) => r.json()),
  ambil("batas_sekitar.geojson").then((r) => r.json()),
]).then(([m, biner, gjFas, tp, batas, sekitar]) => {
  meta = m; asap = new Float32Array(biner); titikPanas = tp;
  siapkanFasilitas(gjFas);
  buatPeta(batas, sekitar);
  pasangKontrol();
  overlay();
  buatGrafikTitik();
  gantiMode("harian");
}).catch((e) => { el("peta").textContent = "Data tidak dapat dimuat: " + e.message; });

/* ---------- WAKTU ---------- */
const jumlahLangkah3Jam = () => meta.waktu_utc.length;
const jumlahHari = () => jumlahLangkah3Jam() / 8;                       // 8 langkah 3 jam = 1 hari
const jumlahLangkah = () => (mode === "harian" ? jumlahHari() : jumlahLangkah3Jam());
function keWIT(iso) { return new Date(new Date(iso).getTime() + 9 * 3600e3); }   // WIT = UTC + 9 jam
function tulisWaktu(iso) {
  const d = keWIT(iso);
  return d.getUTCDate() + " " + BULAN[d.getUTCMonth()] + ", " + String(d.getUTCHours()).padStart(2, "0") + ".00 WIT";
}
function labelWaktu(i) {
  if (mode === "3jam") return tulisWaktu(meta.waktu_utc[i]) + " (rata-rata 3 jam)";
  const awal = meta.waktu_utc[i * 8], akhir = new Date(new Date(awal).getTime() + 24 * 3600e3).toISOString();
  return tulisWaktu(awal) + " sampai " + tulisWaktu(akhir);
}
function tanggalUTC(i) { return +meta.waktu_utc[mode === "harian" ? i * 8 : i].slice(8, 10); }   // untuk titik panas

/* ---------- RASTER ---------- */
const jumlahSel = () => meta.nx * meta.ny;
// Nilai indeks asap (0..1) seluruh sel pada waktu i. Mode harian = rata-rata 8 langkah 3 jam.
function rasterPada(i) {
  const n = jumlahSel();
  if (mode === "3jam") return asap.subarray(i * n, (i + 1) * n);
  const hasil = new Float32Array(n);
  for (let k = 0; k < 8; k++) { const awal = (i * 8 + k) * n; for (let s = 0; s < n; s++) hasil[s] += asap[awal + s] / 8; }
  return hasil;
}
// Kelas asap dari nilai indeks: -1 tanpa asap, 0 rendah, 1 sedang, 2 tinggi, 3 sangat tinggi.
function kelasDari(v) {
  const a = meta.ambang_kelas;
  return v <= 0.005 ? -1 : v < a[0] ? 0 : v < a[1] ? 1 : v < a[2] ? 2 : 3;
}
function hexKeRGB(h) { return [1, 3, 5].map((p) => parseInt(h.slice(p, p + 2), 16)); }
function gambarAsap() {
  const nilai = rasterPada(indeksWaktu), ctx = kanvas.getContext("2d"), gambar = ctx.createImageData(meta.nx, meta.ny);
  const rgb = WARNA.map(hexKeRGB);
  for (let s = 0; s < nilai.length; s++) {
    const k = kelasDari(nilai[s]);
    if (k < 0) continue;                                   // tanpa asap: biarkan transparan
    gambar.data[s * 4] = rgb[k][0]; gambar.data[s * 4 + 1] = rgb[k][1]; gambar.data[s * 4 + 2] = rgb[k][2]; gambar.data[s * 4 + 3] = 235;
  }
  ctx.putImageData(gambar, 0, 0);
  lapisAsap.setUrl(kanvas.toDataURL());
}

/* ---------- 3. OVERLAY FASILITAS DENGAN RASTER ---------- */
function siapkanFasilitas(gj) {
  const [barat, selatan, timur, utara] = meta.bbox;
  const dx = (timur - barat) / meta.nx, dy = (utara - selatan) / meta.ny;
  fasilitas = gj.features.filter((f) => f.geometry && f.geometry.type === "Point").map((f) => {
    const [bujur, lintang] = f.geometry.coordinates;
    const kolom = Math.floor((bujur - barat) / dx), baris = Math.floor((utara - lintang) / dy);   // baris 0 = paling utara
    const sel = kolom >= 0 && kolom < meta.nx && baris >= 0 && baris < meta.ny ? baris * meta.nx + kolom : -1;
    return { nama: f.properties.nama, jenis: f.properties.jenis, bujur, lintang, sel };
  });
}
// Hitung untuk tiap fasilitas: berapa langkah 3 jam terdampak, kapan pertama kali, dan nilai puncaknya.
function overlay() {
  const n = jumlahSel(), T = jumlahLangkah3Jam();
  fasilitas.forEach((f) => {
    f.langkahTerdampak = []; f.puncak = 0;
    if (f.sel < 0) return;
    for (let t = 0; t < T; t++) {
      const v = asap[t * n + f.sel];
      if (v > f.puncak) f.puncak = v;
      if (kelasDari(v) >= ambang) f.langkahTerdampak.push(t);
    }
  });
  perbaruiRingkasan();
  buatGrafikFasilitas();
}
const nilaiSaatIni = (f, raster) => (f.sel < 0 ? 0 : raster[f.sel]);

/* ---------- 2. PETA ---------- */
function buatPeta(batas, sekitar) {
  const [barat, selatan, timur, utara] = meta.bbox;
  peta = L.map("peta", { minZoom: 7, maxZoom: 14 });
  const osm = "https://tile.openstreetmap.org/{z}/{x}/{y}.png", hak = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  petaDasar.terang = L.tileLayer(osm, { attribution: hak, className: "ubin-terang" }).addTo(peta);
  petaDasar.osm = L.tileLayer(osm, { attribution: hak });
  petaDasar.citra = L.tileLayer("", { attribution: "Citra: NASA GIBS, VIIRS NOAA-20", maxNativeZoom: 9 });
  L.control.scale({ imperial: false }).addTo(peta);

  kanvas = document.createElement("canvas"); kanvas.width = meta.nx; kanvas.height = meta.ny;
  lapisAsap = L.imageOverlay(kanvas.toDataURL(), [[selatan, barat], [utara, timur]], { opacity: 0.6, interactive: false }).addTo(peta);
  lapisSekitar = L.geoJSON(sekitar, { style: { color: "#51655f", weight: 1, fill: false }, interactive: false });
  lapisBatas = L.geoJSON(batas, { style: { color: "#16302b", weight: 2, fill: false, dashArray: "6 4" }, interactive: false }).addTo(peta);
  lapisTitik = L.layerGroup().addTo(peta);
  lapisFas = L.layerGroup().addTo(peta);
  fasilitas.forEach((f) => { f.penanda = L.circleMarker([f.lintang, f.bujur], { radius: 5 }); });
  peta.fitBounds(lapisBatas.getBounds(), { padding: [10, 10] });
}
function gambarFasilitas() {
  const raster = rasterPada(indeksWaktu);
  lapisFas.clearLayers();
  fasilitas.forEach((f) => {
    const v = nilaiSaatIni(f, raster), k = kelasDari(v), kena = k >= ambang;
    f.penanda.setStyle(kena ? { radius: 7, color: "#16302b", weight: 1.5, fillColor: WARNA[k], fillOpacity: 1 }
                            : { radius: 4, color: "#6b7c77", weight: 1, fillColor: "#fff", fillOpacity: 0.95 });
    f.penanda.bindPopup("<b>" + f.nama + "</b><br>" + (JENIS[f.jenis] || f.jenis) + "<br>Kelas asap: " + (k < 0 ? "tanpa asap" : KELAS[k]) +
      "<br>Indeks: " + v.toFixed(2).replace(".", ",") + "<br>Lama terdampak 1–11 Okt: " + f.langkahTerdampak.length * 3 + " jam");
    lapisFas.addLayer(f.penanda);
    if (kena) f.penanda.bringToFront();
  });
}
function gambarTitikPanas() {
  lapisTitik.clearLayers();
  const tgl = tanggalUTC(indeksWaktu);
  titikPanas.filter((t) => t[2] === tgl).forEach((t) => {
    L.circleMarker([t[1], t[0]], { radius: 2.5, color: "#d7301f", weight: 0, fillColor: "#d7301f", fillOpacity: 0.85, interactive: false }).addTo(lapisTitik);
  });
}
function gambarLegenda() {
  const a = meta.ambang_kelas.map((v) => v.toFixed(2).replace(".", ","));
  const batas = ["< " + a[0], a[0] + "–" + a[1], a[1] + "–" + a[2], "> " + a[2]];
  el("legenda").innerHTML = "<b>Indeks asap relatif</b>" +
    KELAS.map((k, i) => '<div><i style="background:' + WARNA[i] + '"></i>' + k + " (" + batas[i] + ")</div>").join("") +
    '<hr><div><i class="bulat" style="background:' + WARNA[2] + '"></i>Fasilitas terdampak</div>' +
    '<div><i class="bulat" style="background:#fff"></i>Fasilitas tidak terdampak</div>' +
    '<div><i class="bulat" style="background:#d7301f;border:0"></i>Titik panas</div>';
}

/* ---------- 4. TABEL DAN GRAFIK ---------- */
function barisTabel() {
  const raster = rasterPada(indeksWaktu), jenis = el("jenis").value, cari = el("cari").value.trim().toLowerCase(), hanya = el("hanya").checked;
  return fasilitas.map((f) => ({ f, v: nilaiSaatIni(f, raster) })).map((b) => ({ ...b, k: kelasDari(b.v) }))
    .filter((b) => (!jenis || b.f.jenis === jenis) && (!cari || b.f.nama.toLowerCase().includes(cari)) && (!hanya || b.k >= ambang))
    .sort((x, y) => y.f.langkahTerdampak.length - x.f.langkahTerdampak.length || y.v - x.v);
}
function gambarTabel() {
  const baris = barisTabel(), badan = document.querySelector("#tabel tbody");
  badan.textContent = "";
  baris.forEach(({ f, v, k }) => {
    const tr = document.createElement("tr"), awal = f.langkahTerdampak[0];
    const sel = [f.nama, JENIS[f.jenis] || f.jenis, null, v.toFixed(2).replace(".", ","), f.langkahTerdampak.length * 3 + " jam",
                 awal === undefined ? "Tidak pernah" : tulisWaktu(meta.waktu_utc[awal])];
    sel.forEach((isi, i) => {
      const td = document.createElement("td");
      if (i === 2) {
        const cap = document.createElement("span"); cap.className = "cap"; cap.textContent = k < 0 ? "Tanpa asap" : KELAS[k];
        if (k >= 0) { cap.style.background = WARNA[k]; if (k >= 2) cap.style.color = "#fff"; }
        td.appendChild(cap);
      } else td.textContent = isi;
      if (i === 3 || i === 4) td.className = "angka";
      tr.appendChild(td);
    });
    tr.addEventListener("click", () => { peta.setView([f.lintang, f.bujur], 12); f.penanda.openPopup(); el("peta").scrollIntoView({ behavior: "smooth", block: "center" }); });
    badan.appendChild(tr);
  });
  const kena = baris.filter((b) => b.k >= ambang).length;
  el("t-ringkas").textContent = baris.length ? baris.length + " fasilitas ditampilkan; " + kena + " terdampak pada waktu yang sedang tampil."
    : "Tidak ada fasilitas yang cocok. Ubah jenis, pencarian, atau hapus centang “hanya yang terdampak”.";
}
function perbaruiRingkasan() {
  const T = jumlahLangkah3Jam(), perLangkah = new Array(T).fill(0);
  fasilitas.forEach((f) => f.langkahTerdampak.forEach((t) => perLangkah[t]++));
  const maks = Math.max(...perLangkah), kapan = perLangkah.indexOf(maks);
  const tp = Object.values(meta.titik_panas_per_hari).reduce((j, h) => j + (h.Sorong || 0), 0);
  el("s-titik").textContent = tp.toLocaleString("id-ID");
  el("s-fas").textContent = fasilitas.length;
  el("s-kena").textContent = fasilitas.filter((f) => f.langkahTerdampak.length).length;
  el("s-puncak").textContent = maks ? tulisWaktu(meta.waktu_utc[kapan]).replace(" WIT", "") : "–";
  el("s-puncak-ket").textContent = maks ? "waktu puncak: " + maks + " fasilitas terdampak sekaligus" : "tidak ada fasilitas terdampak pada kelas ini";
}
function labelHari() { return Array.from({ length: jumlahHari() }, (_, h) => { const d = keWIT(meta.waktu_utc[h * 8]); return d.getUTCDate() + " " + BULAN[d.getUTCMonth()]; }); }
const opsiGrafik = { animation: false, responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
  scales: { x: { stacked: true, ticks: { font: { size: 11 } } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0, font: { size: 11 } } } } };
function buatGrafikFasilitas() {
  const H = jumlahHari(), jenisAda = [...new Set(fasilitas.map((f) => f.jenis))];
  const set = jenisAda.map((j) => ({ label: JENIS[j] || j, backgroundColor: WARNA_JENIS[j] || "#888",
    data: Array.from({ length: H }, (_, h) => fasilitas.filter((f) => f.jenis === j && f.langkahTerdampak.some((t) => Math.floor(t / 8) === h)).length) }));
  if (grafikFas) grafikFas.destroy();
  grafikFas = new Chart(el("g-fas"), { type: "bar", data: { labels: labelHari(), datasets: set }, options: opsiGrafik });
}
function buatGrafikTitik() {
  const hari = Object.keys(meta.titik_panas_per_hari).sort(), nama = { Sorong: "Kabupaten Sorong", "Luar Papua Barat Daya": "Luar provinsi" };
  const wilayah = ["Sorong", "Kota Sorong", "Sorong Selatan", "Raja Ampat", "Maybrat", "Tambrauw", "Luar Papua Barat Daya"];
  const warna = ["#b5562b", "#5b2a3c", "#0f6b5c", "#3b4cc0", "#c98a00", "#7a9a01", "#9aa7a3"];
  const set = wilayah.map((w, i) => ({ label: nama[w] || w, backgroundColor: warna[i], data: hari.map((h) => meta.titik_panas_per_hari[h][w] || 0) }));
  grafikTitik = new Chart(el("g-titik"), { type: "bar", data: { labels: hari.map((h) => +h.slice(8) + " Okt"), datasets: set }, options: opsiGrafik });
}
function unduhCSV() {
  const kutip = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const kepala = ["nama", "jenis", "bujur", "lintang", "waktu_tampil", "kelas", "indeks", "lama_terdampak_jam", "pertama_terdampak"];
  const isi = barisTabel().map(({ f, v, k }) => [f.nama, JENIS[f.jenis] || f.jenis, f.bujur, f.lintang, labelWaktu(indeksWaktu), k < 0 ? "Tanpa asap" : KELAS[k],
    v.toFixed(3), f.langkahTerdampak.length * 3, f.langkahTerdampak.length ? tulisWaktu(meta.waktu_utc[f.langkahTerdampak[0]]) : ""].map(kutip).join(","));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + kepala.join(",") + "\n" + isi.join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = "fasilitas_terdampak.csv"; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- KONTROL ---------- */
function tampilkan(i) {                       // dipanggil setiap kali waktu berubah
  indeksWaktu = Math.max(0, Math.min(jumlahLangkah() - 1, i));
  el("w-geser").value = indeksWaktu;
  el("w-teks").textContent = labelWaktu(indeksWaktu);
  gambarAsap(); gambarFasilitas(); gambarTitikPanas(); gambarTabel(); perbaruiCitra();
}
function gantiMode(baru) {
  const hari = mode === "harian" ? indeksWaktu : Math.floor(indeksWaktu / 8);   // tetap pada hari yang sama
  mode = baru;
  el("w-geser").max = jumlahLangkah() - 1;
  tampilkan(mode === "harian" ? hari : hari * 8);
}
function perbaruiCitra() {
  if (!peta.hasLayer(petaDasar.citra)) return;
  const tgl = meta.waktu_utc[mode === "harian" ? indeksWaktu * 8 : indeksWaktu].slice(0, 10);
  const url = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/" + tgl + "/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg";
  if (petaDasar.citra._url !== url) petaDasar.citra.setUrl(url);
}
function pasangKontrol() {
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", () => gantiMode(r.value)));
  el("w-geser").addEventListener("input", (e) => tampilkan(+e.target.value));
  el("w-mundur").addEventListener("click", () => tampilkan(indeksWaktu - 1));
  el("w-maju").addEventListener("click", () => tampilkan(indeksWaktu + 1));
  el("w-putar").addEventListener("click", () => {
    if (pemutar) { clearInterval(pemutar); pemutar = null; el("w-putar").textContent = "Putar"; return; }
    el("w-putar").textContent = "Berhenti";
    pemutar = setInterval(() => tampilkan((indeksWaktu + 1) % jumlahLangkah()), 900);
  });
  const saklar = (id, lapis) => el(id).addEventListener("change", (e) => (e.target.checked ? lapis().addTo(peta) : peta.removeLayer(lapis())));
  saklar("l-asap", () => lapisAsap); saklar("l-titik", () => lapisTitik); saklar("l-fas", () => lapisFas);
  saklar("l-batas", () => lapisBatas); saklar("l-sekitar", () => lapisSekitar);
  el("alpha").addEventListener("input", (e) => { el("alpha-o").textContent = e.target.value; lapisAsap.setOpacity(1 - e.target.value / 100); });
  el("dasar").addEventListener("change", (e) => {
    Object.values(petaDasar).forEach((l) => peta.removeLayer(l));
    petaDasar[e.target.value].addTo(peta).bringToBack(); perbaruiCitra();
  });
  [...new Set(fasilitas.map((f) => f.jenis))].forEach((j) => { const o = document.createElement("option"); o.value = j; o.textContent = JENIS[j] || j; el("jenis").appendChild(o); });
  el("ambang").addEventListener("change", (e) => { ambang = +e.target.value; overlay(); gambarFasilitas(); gambarTabel(); });
  ["jenis", "hanya"].forEach((id) => el(id).addEventListener("change", gambarTabel));
  el("cari").addEventListener("input", gambarTabel);
  el("unduh").addEventListener("click", unduhCSV);
  gambarLegenda();
}
