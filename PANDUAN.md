# Ariffin Jewels — Operasi Emas

## Buka sistem

**Salinan kod awam ini bermula dengan ruang operasi kosong.** Tiada rekod sejarah perniagaan, akaun pengguna operasi atau lampiran transaksi disertakan. **Data contoh** ialah ruang latihan pilihan. Nama pembekal, nombor akaun contoh dan transaksi di dalamnya adalah rekaan.

**Versi Windows** menggunakan storan sendiri pada komputer. Ekstrak keseluruhan ZIP ke folder yang boleh ditulis. Klik dua kali **MULA.cmd** dan biarkan tetingkap pelayan terbuka. Jika pelayar tidak terbuka, gunakan `http://127.0.0.1:4317`. Pelancar menggunakan Node.js 22.13 atau lebih baharu dengan modul SQLite, termasuk runtime Codex jika tersedia. Tiada pemasangan pakej npm diperlukan.

Jika menggunakan terminal dan Node.js yang sesuai, jalankan `node server.mjs` dari folder yang mengandungi `package.json`, kemudian buka `http://127.0.0.1:4317`. Pilih **Buka ruang sebenar**, daftarkan pengurus pertama, kemudian pilih **Tetapan & akses → Tambah pengguna**. Semua rekod tempatan disimpan pada komputer tersebut.

## Satu pembelian dari awal hingga selesai

1. **Daftarkan ejen dan kilang.** Masukkan maklumat bank dan pilih WeBuy atau Tahil mengikut persetujuan dengan pembekal. Untuk Tahil, masukkan gram setiap tahil. Tetapkan kadar bayaran awal bagi setiap kilang. Nilai 90% boleh diubah.
2. **Mohon dana.** Staf pilih ejen, nyatakan amaun dan tujuan. Pengurusan luluskan amaun. Akauntan atau pengurusan merekod pindahan dengan bukti bank dan nombor rujukan.
3. **Rekod belian.** Pilih permohonan yang telah menerima dana. Masukkan pemilik, gambar, berat, mutu dan harga. Lampirkan invois dan nombornya. Akauntan membandingkan invois dengan nilai lot dan pindahan, mengesahkan bil, kemudian menutup permohonan selepas baki diselesaikan.
4. **Padankan dana.** Pulangkan lebihan dengan bukti transaksi bank. Jika kos disahkan melebihi pindahan, semak baki dan kelulusan tambahan sebelum merekod bayaran. Setiap pembelian baharu menggunakan permohonan baharu.
5. **Rekod MKS dan tarik.** Rekod nombor, masa, harga RM/g dan berat lock. Beberapa lock boleh melengkapkan satu lot. Pilih **Tarik** untuk memasukkan timbangan serta gambar sebelum dan selepas. Pilih **Tidak tarik** untuk membawa berat asal.
6. **Terima dan hantar emas.** Untuk emas milik Ariffin atau pihak ketiga yang dihantar tanpa pembelian, rekodkan lot jagaan dengan pemilik dan bukti. Gabungkan lot, semak jumlah berat, lampirkan gambar dan keluarkan Gold Delivery Form. Timbang setiap lot ketika diterima. Terangkan sebarang perbezaan sebelum mengeluarkan akuan penerimaan. Pilih lot diterima untuk penghantaran ke kilang.
7. **Masukkan PR dan assay.** Buka penghantaran ke kilang, rekod PR dan masukkan keputusan untuk setiap lot. Gunakan penyata pemilik untuk mengeluarkan keputusan pihak berkenaan.
8. **Selesaikan jualan.** Rekod pendahuluan sehingga peratus yang dipersetujui bagi kilang itu. Selepas bil, assay setiap lot, harga dan kos disahkan, muktamadkan nilai jualan dan rekod baki bayaran yang diterima.
9. **Semak dan cetak.** Pilih **Laporan** untuk penapis tarikh, ejen, kilang, rujukan dan status. Pada **Dokumen PDF**, pilih jenis serta rekod sumber. Klik **Muat turun PDF** atau **Cetak**. Dokumen latihan bertanda CONTOH.

## Pengiraan

| Perkara | Pengiraan |
| --- | --- |
| WeBuy | Berat asal dalam gram × harga manual RM/g |
| Tahil | Berat dalam gram ÷ gram setiap tahil mengikut kontrak × RM/tahil |
| Baki dana | Pindahan − belian yang disahkan − pemulangan disahkan |
| Susut proses | Berat sebelum tarik − berat selepas tarik |
| Perbezaan assay | Berat sebelum assay − berat selepas assay |
| Stok di Ariffin | Jumlah berat lot yang telah ditimbang terima dan masih berada di Ariffin |
| Baki kilang | Nilai jualan selepas pelarasan − bayaran diterima |
| Untung kasar | Jualan bersih − kos belian lot − kos langsung |

Amaun wang dibundarkan kepada sen. Berat menggunakan gram hingga tiga tempat perpuluhan. Mutu menggunakan ‰, contohnya 916. Rekod jualan sementara dan muktamad mempunyai status berbeza.

## Import rekod sedia ada

Apabila dokumen lama ditemui, buka rekod asal dan pilih tindakan padanan atau buka **Audit & pembetulan → Padankan rekod**. Pilih transaksi, masukkan butiran yang disokong dokumen dan lampirkan bukti. Pengurusan menyemak permohonan daripada pengguna lain. Untuk padanan kewangan, akauntan memohon. Terimaan bank yang meliputi beberapa invois boleh diperuntukkan mengikut amaun pada bukti.

Gunakan helaian milik organisasi anda sendiri. Untuk mengekalkan kaedah harga pembekal semasa migrasi lejar, daftarkan profil pembekal dengan nama yang sama dan tetapkan kaedah harga dahulu. Profil baharu daripada lejar yang belum mempunyai kaedah boleh dilengkapkan melalui **Ejen & pembekal → Daftar ejen** dengan nama yang sama.

Dalam Google Sheets, muat turun helaian sebagai CSV atau salin sel bersama tajuk lajur. Pilih **Import data**, jenis rekod, padankan lajur dan pilih fail lampiran yang sepadan. Semak pratonton sebelum mengimport. Had satu kumpulan ialah 250 baris. Untuk data berkaitan, import ejen dan kilang dahulu, kemudian permohonan, kelulusan, pindahan dan lot mengikut turutan. Gunakan rujukan sistem untuk rekod induk. Satu kumpulan hanya disimpan apabila semua tindakan lulus semakan.

## Kawalan dan persediaan operasi

- **Staf** merekod operasi. **Akauntan** mengesahkan bil dan bank. **Pengurusan** meluluskan permohonan, menyemak pembetulan dan mengurus akses.
- Buka **Jejak audit**, cari rujukan dan pilih catatan untuk memohon pembetulan. Sertakan perubahan serta sebab. Pengurus selain pemohon mesti meluluskan perubahan. Sejarah menyimpan input asal dan nilai berkuat kuasa. Pembetulan yang bercanggah dengan transaksi berikutnya perlu disemak bersama transaksi berkaitan.
- **e-Invois** menyimpan rujukan, status dan salinan dokumen MyInvois. Penghantaran dan pengesahan rasmi dibuat melalui saluran MyInvois syarikat. Integrasi terus dengan API LHDN memerlukan pembangunan dan kelayakan berasingan.
- Kadar sebenar, gram/tahil, unit WeBuy yang dipersetujui, akaun bank, pengguna, terma kilang dan data pembukaan perlu disediakan oleh syarikat. Tiada kadar pasaran langsung digunakan. Sebelum memulakan operasi, padankan satu transaksi sebenar bersama akauntan.
- Versi Windows menyimpan pangkalan data di **data/operasi.sqlite** dan lampiran di **data/files**. Untuk sandaran, hentikan pelayan, salin **seluruh** folder data ke lokasi sandaran dan buka semula pelayan. Untuk pulih, hentikan pelayan, simpan salinan data semasa dan pulihkan folder sandaran yang lengkap.
- Untuk penyelenggaraan kod, jalankan `node --test` untuk ujian dan `node build.mjs` untuk membina Worker web. Versi web menggunakan D1 untuk rekod dan R2 untuk fail.

