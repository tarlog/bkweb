# Painter's gallery

A fully static website for GitHub Pages, plus a mobile admin app for adding paintings from a phone.

```
index.html, assets/        Public gallery (no build step, no server)
data/paintings.json        All painting data (title, medium, size, year, description, status, keywords)
data/site.json             Artist name, tagline, about text, contact email
images/full/               Viewing images: max 1600 px, JPEG ~76-78% (~300 KB)
images/thumb/              Gallery thumbnails: max 600 px (~50 KB)
admin/                     Mobile admin app (installable Progressive Web App)
```

## "See it on your wall"

Visitors can open any painting on a photo of their own room (or a sample room), move and resize it, pick a
frame, and save the result to their device. With **Set real scale** they mark an object of known length
(e.g. a door) and the painting is shown at its true size, using the width/height from `paintings.json`.

Privacy: the room photo is decoded locally in the browser (`assets/room.js`) and never uploaded or stored.
The public page also sets a Content-Security-Policy (`connect-src 'self'`, `form-action 'none'`) so the
browser itself blocks any attempt to send data to another site.

## Image quality policy

Every image is resized to at most **1600 px** on the long edge and re-encoded as JPEG (quality ~78).
That looks sharp on phones, tablets and laptops, but it is only ~5 inches at print resolution (300 dpi),
so it is not usable for quality prints. Re-encoding also strips EXIF metadata (including GPS location).
The admin app does this on the phone before uploading, so originals never leave the device.

## The admin app

Open `https://<username>.github.io/<repo>/admin/` on the phone.

* **Android (Chrome):** menu ⋮ → *Install app* / *Add to Home screen*. After installing, you can also
  *Share* a photo from the Gallery app straight to “Gallery Admin”.
* **iPhone (Safari):** Share button → *Add to Home Screen*.

What it does: take or choose a photo → fill in title, medium, size, year, status, keywords and description →
**Save & publish**. It resizes the photo, commits the image, thumbnail and updated `paintings.json` to
GitHub in a single commit, and GitHub Pages republishes the site within a minute or two. You can also
edit, delete and reorder paintings, and edit the artist name/about text (✎ button).

### Create the access token for the app (once per phone)

1. Sign in to GitHub, open <https://github.com/settings/personal-access-tokens/new>.
2. **Token name:** `gallery-admin-phone`. **Expiration:** e.g. 1 year (put a reminder to renew).
3. **Repository access:** *Only select repositories* → choose this repository only.
4. **Permissions → Repository permissions → Contents:** *Read and write*. (Metadata: Read-only is added automatically.) Nothing else.
5. **Generate token**, copy it, paste it into the app's *Access token* field and tap **Connect**.

The token is stored only on that phone (browser local storage). If the phone is lost, delete the token at
<https://github.com/settings/personal-access-tokens>. Use ⚙ → *Forget token on this device* to sign out.

## Editing by hand

You can also edit `data/*.json` directly on github.com. For new images, resize first, e.g.:

```sh
convert photo.jpg -auto-orient -strip -resize '1600x1600>' -quality 78 images/full/NAME.jpg
convert photo.jpg -auto-orient -strip -resize '600x600>'   -quality 72 images/thumb/NAME.jpg
```

## Local preview

```sh
python3 -m http.server 8000 --bind 127.0.0.1   # then open http://127.0.0.1:8000/
```
