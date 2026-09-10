# Empire CNC — AI Depth Map Mikroservisi (Depth Anything V2 Base + rembg)

Bu servis, fotoğraflardan (portreler, kabartma motifleri, hayvan figürleri vb.) monoküler derinlik tahmini yaparak CNC bas-rölyef işlemeye hazır **0-255 normalize edilmiş gri tonlamalı PNG derinlik haritası** üretir. Girdi görselleri işlenmeden önce en fazla **1024×1024 px** boyutuna ölçeklenir, ardından **rembg (U²-Net)** ile arka plan maskelenip zemin derinliği **0**'a çekilir.

## Hızlı Başlatma (Windows)
1. Bu klasördeyken `start.bat` dosyasına çift tıklayın veya PowerShell'de `./start.ps1` çalıştırın.
2. Servis `http://127.0.0.1:8000` adresinde hazır olur.

## Manuel Kurulum
```bash
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

## NVIDIA CUDA (GPU) Hızlandırması (Önerilir)
Eğer NVIDIA ekran kartınız varsa, PyTorch CUDA sürümünü kurarak işlem süresini ~0.2 saniyeye düşürebilirsiniz:
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

## Endpoint'ler
- `GET /health` -> Servis, model ve rembg durumu
- `POST /generate-depth` (veya `/predict-depth`) -> Görsel alır, 16-bit ham depth verisi (Base64) döner
## Arka Plan Maskeleme (rembg / U²-Net)
`rembg` paketi `requirements.txt` içindedir ve ilk çalıştırmada `u2net.onnx` modelini (~170MB) otomatik indir. Maske derinlik haritasına uygulanmadan önce Gaussian feather ile yumuşatılır; böylece gökyüzü/zemin 0 seviyesine inerken nesne kenarlarında keskin duvar yerine CNC'ye uygun yumuşak bir ramp kalır.
