# Siteyi internete koyma (ücretsiz: Render + MongoDB Atlas)

Site GitHub'daki `main` dalından çalışır. Bilgisayarınızda geliştirip `git push`
yaptığınızda Render siteyi birkaç dakika içinde kendiliğinden günceller.
Hesaplar ve modeller MongoDB Atlas'ta durur (ücretsiz sunucunun diski her yeniden
başlamada sıfırlandığı için orada tutulamaz).

## 1. MongoDB Atlas (bir kerelik, ~5 dk)

1. https://www.mongodb.com/cloud/atlas/register → Google hesabınızla kayıt olun.
2. **Create a deployment** → **M0 (Free)** → bölge olarak Frankfurt (eu-central-1) → **Create**.
3. Açılan pencerede bir **kullanıcı adı ve şifre** oluşturun (Create Database User).
   Şifrede `@ : / ? #` gibi işaretler olmasın, adreste sorun çıkarır.
4. **Network Access** → **Add IP Address** → **Allow access from anywhere** (`0.0.0.0/0`).
   Render'ın adresi sabit olmadığı için gerekli; güvenliği kullanıcı adı/şifre sağlar.
5. **Connect** → **Drivers** → adresi kopyalayın. Şuna benzer:
   `mongodb+srv://KULLANICI:SIFRE@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
   Adresin içindeki `/?` kısmını `/empire?` yapın (veritabanının adı olur):
   `mongodb+srv://KULLANICI:SIFRE@cluster0.xxxxx.mongodb.net/empire?retryWrites=true&w=majority`

## 2. Render (bir kerelik, ~10 dk)

1. https://render.com → GitHub hesabınızla giriş → **New → Web Service** → `cncv3` deposu.
2. Ayarlar:

   | Alan | Değer |
   |---|---|
   | Branch | `main` |
   | Runtime | Node |
   | Build Command | `npm run install:all && npm run build` |
   | Start Command | `npm start` |
   | Instance Type | Free |

3. **Environment Variables** (Ortam değişkenleri):

   | Ad | Değer |
   |---|---|
   | `NODE_VERSION` | `20` |
   | `MONGODB_URI` | 1. adımdaki adres |
   | `ADMIN_EMAIL` | Sizin e-postanız (sadece bu adres yönetici olur) |
   | `SESSION_SECRET` | Uzun, rastgele bir metin (ör. 40 karışık harf/rakam) |

4. **Create Web Service**. İlk kurulum birkaç dakika sürer; sonunda
   `https://….onrender.com` adresi çıkar.
5. Siteyi açın → **Kayıt ol** → `ADMIN_EMAIL`'deki adresle kayıt olun: yönetici
   olarak doğrudan girersiniz. Modeller ilk açılışta veritabanına kendiliğinden yüklenir.
6. Abiniz kayıt olsun → siz **Atölye → Kullanıcılar**'dan onaylayıp süre verin.

## Bilmeniz gerekenler

- Ücretsiz plan 15 dakika kimse girmezse uyur; ilk açılış 30–60 sn sürer.
- **Modeller artık veritabanında.** Siteden (Atölye → Modeller) yaptığınız
  değişiklikler kalıcıdır. Bilgisayarınızdaki `server/data/presets.json` sadece
  boş bir veritabanına ilk yüklemede kullanılır.
- Bilgisayarınızda da aynı veritabanını kullanmak için `server/.env.local`
  dosyası oluşturup içine şunu yazın (bu dosya GitHub'a gitmez):

  ```
  MONGODB_URI=mongodb+srv://KULLANICI:SIFRE@cluster0.xxxxx.mongodb.net/empire?retryWrites=true&w=majority
  ADMIN_EMAIL=sizin@epostaniz.com
  SESSION_SECRET=render'dakiyle-ayni-metin
  ```

  Böylece bilgisayarınız ve site aynı hesapları ve modelleri görür.
- `server/data/users.json` (bilgisayardaki hesaplar) GitHub'a gönderilmez.
