# 🚀 Step Challenge – Paigaldusjuhend

## Mida sa vajad

- **GitHub konto** → [github.com](https://github.com)
- **Supabase konto** → [supabase.com](https://supabase.com) (tasuta)
- **Vercel konto** → [vercel.com](https://vercel.com) (tasuta, logi GitHubiga sisse)

---

## Samm 1: Supabase projekti loomine (~5 min)

1. Mine [supabase.com](https://supabase.com) → **Start your project**
2. Logi sisse GitHubiga
3. Vajuta **New Project**
4. Pane nimeks nt `step-challenge`
5. Vali regiooniks **West EU (Ireland)** (lähim Eestile)
6. Pane kirja tugev parool → **Create new project**
7. Oota ~2 min kuni projekt valmib

### Andmebaasi seadistamine

1. Mine vasakult menüüst → **SQL Editor**
2. Kopeeri kogu `supabase-setup.sql` faili sisu sinna
3. Vajuta **Run** (roheline nupp)
4. Peaksid nägema "Success" teadet

### API võtmete leidmine

1. Mine vasakult → **Settings** → **API**
2. Kopeeri need kaks asja ja hoia alles:
   - **Project URL** (näeb välja nagu `https://xxxxx.supabase.co`)
   - **anon public** key (pikk tekst `eyJ...` algusega)

---

## Samm 2: GitHub repo loomine (~3 min)

1. Mine [github.com/new](https://github.com/new)
2. Repo nimi: `step-challenge`
3. Jäta **Public** ja vajuta **Create repository**
4. Oma arvutis ava terminal ja käivita:

```bash
# Paki lahti allalaetud step-challenge kaust ja mine sinna
cd step-challenge

# Git init
git init
git add .
git commit -m "Step Challenge app"
git branch -M main
git remote add origin https://github.com/SINU-USERNAME/step-challenge.git
git push -u origin main
```

**NB!** Asenda `SINU-USERNAME` oma GitHub kasutajanimega.

---

## Samm 3: Vercel deploy (~3 min)

1. Mine [vercel.com](https://vercel.com) → **Log in with GitHub**
2. Vajuta **Add New** → **Project**
3. Vali oma `step-challenge` repo → **Import**
4. **Environment Variables** sektsioonis lisa need kaks:

| Nimi | Väärtus |
|------|---------|
| `VITE_SUPABASE_URL` | Sinu Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Sinu Supabase anon key |

5. Vajuta **Deploy**
6. Oota ~1 minut...
7. 🎉 **Sinu äpp on live!** Saad lingi nagu `step-challenge.vercel.app`

---

## Samm 4: Jaga linki community'le! 🎉

Kopeeri oma Verceli link ja jaga seda oma grupis. Igaüks saab:
- Oma nime sisestada
- Igapäevaselt samme logida
- Screenshot'e üles laadida
- Edetabelit vaadata

---

## Kui midagi ei tööta

### "Supabase error" veateade
- Kontrolli et `.env` muutujad on Vercelis õigesti seadistatud
- Kontrolli et SQL script jooksis edukalt läbi

### Pildid ei laadi üles
- Mine Supabase → **Storage** → kontrolli et `screenshots` bucket on olemas
- Kui pole, jooksuta SQL uuesti

### Tahan domeeni muuta
- Vercel → Settings → Domains → Lisa oma domeen (nt `steps.sinudomeen.ee`)

---

## Kasulikud lingid

- Supabase Dashboard: [app.supabase.com](https://app.supabase.com)
- Vercel Dashboard: [vercel.com/dashboard](https://vercel.com/dashboard)
