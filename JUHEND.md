# 🚀 Step Challenge – Juhend

**3 nädalat · 7. september – 27. september 2026 · 21 päeva**

---

## ⚠️ ENNE ALGUST: vana challenge maha (~3 min)

Uus hooaeg algab puhtalt lehelt — kõik senised osalejad, PIN-koodid ja sammud kustutatakse.

### 1. Andmebaas

1. Supabase → **SQL Editor**
2. Kopeeri kogu `supabase-setup.sql` sisu sinna
3. **Run**

See kustutab vanad tabelid ja ehitab uued (21 päeva + loodusboonuse veerud).

### 2. Vanad pildid Storage'ist

SQL **ei kustuta pilte** — need jäävad 1 GB tasuta kvoodi sisse orvuks vedelema. Käsitsi:

1. Supabase → **Storage** → `screenshots`
2. Vali kõik failid → **Delete**

### 3. Kontroll

Ava äpp. Sisselogimise ekraanil peab kirjas olema **0 osalejat** ja tekst "Registreeru esimesena".

---

## 🎯 Reeglid

### Punktid

**1 samm = 1 punkt.** Edetabel on üks, aga reaalselt tehtud sammud ja boonused on alati eraldi näha, nii et keegi ei pea arvama, kust punktid tulid. Edetabelit saab sortida nii punktide kui puhaste sammude järgi.

### Päevanorm

**5 000 sammu.** Selle täitmine hoiab seeriat elus. Lävi on tahtlikult madal — mõte on, et keegi ei kukuks mängust välja ühe kiire tööpäeva pärast.

### 🔥 Streak-boonused

**Streak** = järjestikused päevad, kus päevanorm on täis. Ühel inimesel võib challenge'i jooksul olla mitu streak'i.

| Streak | Boonus | Kordused |
|---|---|---|
| 3 päeva | +1 500 | uue streak'iga uuesti teenitav |
| 7 päeva | +4 000 | uue streak'iga uuesti teenitav |
| 10 päeva | +6 000 | üks kord |
| 14 päeva | +10 000 | üks kord |
| **21 päeva** | **+25 000** | üks kord |

Verstapostid on kumulatiivsed: kes teeb kõik 21 päeva, saab **+46 500**.

Jokkerit ei ole — üks vahelejäänud päev katkestab streak'i. Aga 3- ja 7-päevase saab uue streak'iga tagasi teenida, seega ühest eksimusest challenge veel läbi ei saa.

Üks streak teenib iga verstaposti kõige rohkem korra: 21-päevane streak ei maksa 3-päevast boonust seitse korda välja.

### 🌲 Loodusboonus

**+2 000 punkti** matkaraja / RMK raja / looduses käigu eest.

- Max **1 päevas**, kokku **7 korda** kogu challenge'i jooksul
- Vaja **pilti rajalt** + lühikest kirjeldust, kus käidi
- Sama päeva sammud peavad olema vähemalt **5 000** ehk päevanorm peab olema täidetud

**Ausussüsteem.** Keegi ei kinnita boonust üle. Küll aga on kõik loodusfotod koos kirjeldusega igaühele edetabelis nähtavad, seega parklafoto paistab välja.

### 🏅 Märgised

Iga märgis läheb ühele inimesele — challenge'i lõpus on mitu võitjat, mitte üks:

| | | |
|---|---|---|
| 👟 | **Sammumasin** | Kõige rohkem reaalselt tehtud samme (boonused ei loe) |
| 📈 | **Suurim areng** | 3. nädala keskmine vs 1. nädala oma |
| 🌲 | **Metsainimene** | Kõige rohkem loodusboonuseid |
| 💥 | **Rekordipäev** | Suurim üksik päev |
| ⚖️ | **Kõige ühtlasem** | Väikseim kõikumine päevade vahel |

"Suurim areng" nõuab vähemalt 3 logitud päeva nii 1. kui 3. nädalas — muidu saaks ühe nõrga avapäevaga arengut võltsida.

"Kõige ühtlasem" nõuab, et vähemalt 3/4 seniseks möödunud päevadest oleks logitud. Muidu võidaks märgise kahe ühesuguse päevaga ja siis vaikimisega. Kes käib iga päev umbes sama tempoga, see võidab; kes vaheldab 20 000 ja 2 000 sammu, ei võida.

---

## ⚙️ Reeglite muutmine

Kõik numbrid on ühes kohas, `src/App.jsx` failis päris alguses:

```js
const CHALLENGE_START = new Date("2026-09-07");
const CHALLENGE_DAYS = 21;
const DAILY_GOAL = 5000;
const MILESTONES = [ ... ];
const NATURE_BONUS = 2000;
const NATURE_MIN_STEPS = 5000;
const NATURE_MAX = 7;
```

**NB!** Kui muudad `CHALLENGE_DAYS`, muuda ka andmebaasi piirangut `supabase-setup.sql` failis (`day_index < 21`) — muidu viimaste päevade salvestamine ebaõnnestub.

---

## 🛠 Paigaldus nullist

Kui projekt on juba Vercelis üleval, piisab `git push`-ist. Uue seadistuse jaoks:

### Samm 1: Supabase (~5 min)

1. [supabase.com](https://supabase.com) → **New Project**, regiooniks **West EU (Ireland)**
2. **SQL Editor** → kleebi `supabase-setup.sql` → **Run**
3. **Settings → API** → kopeeri **Project URL** ja **anon public** key

### Samm 2: GitHub

```bash
git init
git add .
git commit -m "Step Challenge v3"
git branch -M main
git remote add origin https://github.com/SINU-USERNAME/step-challenge.git
git push -u origin main
```

### Samm 3: Vercel (~3 min)

1. [vercel.com](https://vercel.com) → **Add New → Project** → impordi repo
2. **Environment Variables**:

| Nimi | Väärtus |
|------|---------|
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |

3. **Deploy** → jaga linki grupis 🎉

### Kohapeal käivitamine

```bash
npm install && npm run dev
```

---

## Kui midagi ei tööta

**"Supabase error"** — kontrolli, et `.env` muutujad on Vercelis olemas ja SQL jooksis lõpuni.

**Pilt ei lae üles** — Supabase → Storage → peab olema `screenshots` bucket. Faililagi on 5 MB, lubatud ainult pildid (videod on meelega välja lülitatud, et 1 GB kvoot vastu ei tuleks).

**Viimaste päevade salvestamine ebaõnnestub** — andmebaasis on veel vana `day_index < 14` piirang. Jooksuta `supabase-setup.sql` uuesti.

**Keegi unustas PIN-i** — Supabase → Table Editor → `participants` → kustuta rida, inimene registreerib uuesti. Sammud lähevad kaasa (cascade), seega tee seda ainult siis, kui ta pole veel midagi loginud.
