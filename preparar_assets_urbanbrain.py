from pathlib import Path
import shutil
import sys

# Script para preparar los assets de UrbanBrain sin pelearse con nombres raros.
# Ejecutar desde cualquier sitio:
#   python preparar_assets_urbanbrain.py
# o:
#   py preparar_assets_urbanbrain.py

PROJECT = Path(r"D:\UrbanBrain_App")

# Cambia esta ruta si tienes las imágenes en otra carpeta.
SOURCE = PROJECT / "UrbanBrain General" / "Imagenes Hero"

DEST = PROJECT / "public" / "images"
DEST.mkdir(parents=True, exist_ok=True)

files = [
    ("urbanbrain-logo.jpeg", "logo-urbanbrain.jpeg"),
    ("Hero1.jpg", "hero-1.jpg"),
    ("Hero2.jpg", "hero-2.jpg"),
    ("Hero3.jpg", "hero-3.jpg"),
    ("Hero4.jpg", "hero-4.jpg"),
    ("Hero5.jpg", "hero-5.jpg"),
    ("Hero6.jpg", "hero-6.jpg"),
    ("Hero7.jpg", "hero-7.jpg"),
]

print("========================================")
print(" UrbanBrain - Preparar assets")
print("========================================")
print(f"Origen:  {SOURCE}")
print(f"Destino: {DEST}")
print("")

missing = []
copied = []

for src_name, dst_name in files:
    src = SOURCE / src_name
    dst = DEST / dst_name

    if not src.exists():
        missing.append(src_name)
        print(f"NO ENCONTRADO: {src_name}")
        continue

    shutil.copy2(src, dst)
    copied.append(dst_name)
    print(f"OK: {src_name} -> public/images/{dst_name}")

print("")
print("========================================")

if missing:
    print("FALTAN ARCHIVOS:")
    for name in missing:
        print(f" - {name}")
    print("")
    print("Revisa que los nombres sean exactos y que estén en la carpeta:")
    print(SOURCE)
    sys.exit(1)

print("LISTO. Assets preparados correctamente.")
print("")
print("Archivos copiados:")
for name in copied:
    print(f" - public/images/{name}")

print("")
print("Ahora puedes decirle a Antigravity que use:")
print("/public/images/logo-urbanbrain.jpeg")
print("/public/images/hero-1.jpg ... /public/images/hero-7.jpg")
