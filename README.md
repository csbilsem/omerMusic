# Çokgensel Silindir 🎼

Çokgensel sayıları (üçgensel, karesel, beşgensel…) bir **müzik kutusu silindirine** çivi olarak dizen ve tarayıcıda çalan web uygulaması.

- Kurulum / derleme yok: saf HTML + CSS + JavaScript (Canvas 2D, Web Audio API)
- 8 çokgen katmanı (s = 3…10), her biri kendi renginde
- İki yerleşim: **Kalıntı melodisi** ve **Sarmal sayı doğrusu**
- Gamlar: majör/minör pentatonik, majör, doğal minör, Hicaz (12-TET yaklaşık), tam ton, kromatik
- Silindire tıklayarak çivi ekleme/kaldırma, sürükleyerek döndürme
- **MIDI indir** (GM "Music Box" sesiyle, 2 tur)
- Ayarlar URL'de saklanır → **bağlantıyı kopyala** ile paylaş

## Matematik

`P(s, n) = ((s − 2)·n² − (s − 4)·n) / 2`

| Eşleme | Sütun (zaman) | Satır (nota) |
|---|---|---|
| Kalıntı melodisi | t = n − başlangıç | P(s,n) mod nota_sayısı |
| Sarmal sayı doğrusu | v mod çevre | ⌊v / çevre⌋, v = P(s,n) mod (çevre·nota_sayısı) |

## Dosyalar

```
index.html     sayfa yapısı
style.css      görünüm
app.js         desen hesabı, silindir çizimi, ses, MIDI
netlify.toml   Netlify ayarı (derleme yok, kök klasör yayınlanır)
```

## Yerelde çalıştırma

`index.html` dosyasını tarayıcıda açman yeterli. İstersen:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## GitHub'a yükleme

```bash
git init
git add .
git commit -m "Çokgensel Silindir ilk sürüm"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADIN/cokgensel-silindir.git
git push -u origin main
```

(Ya da GitHub'da yeni repo açıp dosyaları **Add file → Upload files** ile sürükle-bırak.)

## Netlify'da yayınlama

1. app.netlify.com → **Add new site → Import an existing project**
2. **GitHub**'ı seç, `cokgensel-silindir` reposunu seç
3. Build command: *boş*, Publish directory: `.` (netlify.toml zaten ayarlıyor)
4. **Deploy** — her `git push` sonrası site otomatik güncellenir.

Hızlı deneme için: dosyaları içeren klasörü app.netlify.com/drop sayfasına sürükleyip bırakabilirsin.
