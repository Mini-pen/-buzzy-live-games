"""
Jybe Characters - Extraction des images
Double-cliquez ce fichier ou lancez-le avec Python pour extraire les 99 images.
"""
import json, base64, os

script_dir = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(script_dir, "jybe_images.json")
out = os.path.join(script_dir, "images")

print(f"Lecture de : {src}")
print(f"Destination : {out}")
print()

with open(src, encoding="utf-8") as f:
    data = json.load(f)

ok = 0
errors = []
for img_id, entry in data.items():
    b64 = entry.get("b64")
    if not b64:
        continue
    cat = entry.get("category", "divers")
    fname = entry.get("filename", img_id + ".png")
    folder = os.path.join(out, cat)
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, fname)
    try:
        with open(dest, "wb") as f:
            f.write(base64.b64decode(b64))
        ok += 1
        if ok % 10 == 0:
            print(f"  {ok} images extraites...")
    except Exception as e:
        errors.append(f"{img_id}: {e}")

print()
print(f"✓ {ok} images sauvegardées dans : {out}")
if errors:
    print(f"✗ {len(errors)} erreurs : {errors}")

input("\nAppuyez sur Entrée pour fermer...")
