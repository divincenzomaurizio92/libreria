# Libreria di casa

Catalogo dei libri di casa: si scansiona il codice a barre con il telefono e l'app
compila da sola la scheda del libro (titolo, autore, casa editrice, pagine, anno,
copertina, genere suggerito). Ogni dato resta modificabile.

## Come è fatta

| File | A cosa serve |
|---|---|
| `index.html` | La struttura delle schermate |
| `style.css` | Colori, caratteri, impaginazione |
| `app.js` | Tutta la logica, divisa in 10 sezioni commentate |
| `vendor/zxing.min.js` | Libreria che legge i codici a barre dove il browser non lo fa da solo (iPhone) |
| `manifest.webmanifest`, `icons/` | Icona e nome per aggiungere l'app alla schermata Home |

Non c'è nulla da installare o compilare: sono file statici pubblicati con GitHub Pages.

## Da dove arrivano i dati

- Google Books e Open Library, interrogati con l'ISBN letto dal codice a barre.
- I link ad Amazon, Feltrinelli e Mondadori sono ricerche per ISBN.

## Dove sono salvati i libri

Versione 1: nella memoria del browser del telefono (`localStorage`). Dalle impostazioni
si scarica un backup e si esporta un file per Excel. La sincronizzazione tra più
dispositivi è il prossimo passo.

## Provare in locale

La fotocamera funziona solo su `https://` o su `localhost`. Sul PC:

```
python -m http.server 8000
```

e poi aprire `http://localhost:8000`.
