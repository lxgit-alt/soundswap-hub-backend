# Create download_fonts.py and run: python download_fonts.py
import os
import requests

os.makedirs("backend/beam/fonts", exist_ok=True)
os.chdir("backend/beam/fonts")

# Font URLs from Google Fonts CDN (working direct links)
fonts = {
    "CormorantGaramond-Light.ttf": "https://fonts.gstatic.com/s/cormorantgaramond/v16/co3YmX5slCNuHLi8bLeY9MK7whWMhyjQAllvuQ.woff2",
    "Impact.ttf": "https://fonts.gstatic.com/s/impact/v25/Le1yGv3RVyNHTRdzYyfA.woff2",
    "VT323.ttf": "https://fonts.gstatic.com/s/vt323/v17/pxiKyp0ihIEF2hsYHpT2.woff2",
    "Roboto-Bold.ttf": "https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlfBBc4.woff2",
    "PermanentMarker.ttf": "https://fonts.gstatic.com/s/permanentmarker/v16/Fh4uPib9Iyv2ucM6pGQMWimMp004Hao.woff2",
    "BebasNeue-Regular.ttf": "https://fonts.gstatic.com/s/bebasneue/v9/JTUSjIg69CK48gW7PXoo9Wlhyw.woff2",
    "Montserrat-Thin.ttf": "https://fonts.gstatic.com/s/montserrat/v25/JTUSjIg1_i6t8kCHKm459Wlhyw.woff2",
    "Lato-Light.ttf": "https://fonts.gstatic.com/s/lato/v24/S6u9w4BMUTPHh7USSwiPHA.woff2",
}

print("Downloading fonts...")
for font_name, url in fonts.items():
    if not os.path.exists(font_name):
        print(f"Downloading {font_name}...")
        try:
            response = requests.get(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            with open(font_name, 'wb') as f:
                f.write(response.content)
            print(f"  ✓ {font_name} ({len(response.content)} bytes)")
        except Exception as e:
            print(f"  ✗ Failed to download {font_name}: {e}")
    else:
        print(f"✓ {font_name} already exists")

print(f"\nDone! Downloaded {len(fonts)} fonts.")