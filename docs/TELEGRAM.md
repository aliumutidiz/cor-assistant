# Telegram ve yerel sesli komut kurulumu

Linux'ta Telegram bağlantısı ve polling etkin; yalnızca tanımlı grup ve sahibi kabul edilir. Yerel ses kurulumu aşağıdaki ayrı süreçle hazırlanır. Gerçek Türkçe kayıt doğruluğu kullanıcının sesli mesajıyla ayrıca doğrulanmalıdır. AGY için mevcut uygunluk/izolasyon kapıları geçerliliğini korur.

Native Linux kurulumu için `deploy/prepare-speech-linux.py`, paket ve modeli uygulama
sırlarına erişemeyen `cor-build` hesabıyla kurar; başarıdan sonra dosyaları root
sahipli ve uygulama için salt okunur yapar. Ortam `/opt/cor-speech/venv`, model
`/opt/cor-speech/models/small` altında tutulur; uygulama sürümleri değiştiğinde
yeniden indirilmez. Modelin tam sürümü `model.json`, paket sürümleri
`requirements.lock` dosyasında kaydedilir. Kurucu uygulama ayarlarını değiştirmez.
`deploy/verify-speech-linux.py` uygulama hesabıyla çevrimdışı yüklemeyi ve sessizliği
reddetmeyi kontrol eder; bu kontrol gerçek konuşma doğruluğunu kanıtlamaz.

2026-10-20 Linux doğrulaması: faster-whisper 1.2.1 ve PyAV 18.1.0 ile model ağ
erişimi kapatılmış süreçte açıldı ve sessizlik boş metin üretti. İlk kurulumda
PyAV 19'un kaldırdığı `metadata_errors` parametresiyle uyumsuzluk görüldü;
`av>=14,<19` sınırı bu yüzden sabitlendi. Gerçek Telegram ses kaydı bekleniyor.
Serbest doğal dilde takvim işlemi için AGY kapıları hâlâ geçerlidir; sesin metne
çevrilmesi, sohbet sağlayıcısının etkinleştirildiği anlamına gelmez.

## Akış

Telegram → kalıcı gelen kutusu → metin veya yerel ses çözümleme → doğrudan yorumlama → mevcut C.O.R. asistanı → mevcut işlem/onay kuyruğu → sonuç bildirimi.

Anlaşılan sesli mesajlar metin onayı beklenmeden doğrudan işlenir. Riskli takvim değişiklikleri içerikle eşleşen ayrıca işlem onayı gerektirir. Tam ve hatasız konuşma tanıma garantisi verilmez; belirsiz kayıt tekrar istenir.

## 1. Telegram botu

Telegram'ın resmî [BotFather](https://t.me/BotFather) hesabından bir bot oluşturun. Verdiği anahtarı yalnızca sunucunun `.env` dosyasına koyun; sohbet mesajına, ekran görüntüsüne veya sürüm kontrolüne eklemeyin. Kendi sayısal Telegram kullanıcı kimliğinizi doğrulayın; kullanıcı adı kullanılmaz. Kimlik için bot anahtarınızı üçüncü taraf sitelere göndermeyin.

```dotenv
DEMO_MODE=false
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=BOTFATHER_TOKEN
TELEGRAM_OWNER_ID=YOUR_NUMERIC_USER_ID
# Optional: restrict all commands and notifications to this group.
TELEGRAM_CHAT_ID=
```

Önceki PostgreSQL, anahtar ve canlı mod ayarları da gereklidir. Telegram gerçek komutları demo belleğine yönlendirmemek için demo modunda açılamaz.

Botun özel sohbetini açıp `/start` gönderin. Telegram botu kullanıcının başlatmadığı bir sohbeti kendiliğinden başlatamaz. Bu bot anahtarı, ücretli bir LLM API anahtarı değildir; yalnızca Telegram mesaj taşıma kimliğidir.

Komutlar:

- `/start`, `/yardim`, `/help`: kısa kullanım açıklaması.
- `/durum`: Telegram, ses ve AGY durumu.
- `/rutinler`: model kullanmadan rutin listesi.
- Serbest metin: mevcut AGY asistanına gider; AGY kapalıysa açık bir durum mesajı döner.

TELEGRAM_CHAT_ID boşsa yalnızca sahibin özel sohbeti kabul edilir. Negatif bir grup kimliği tanımlanırsa yalnızca o grup veya süpergrup kabul edilir; komutu gönderen kişinin kimliği yine TELEGRAM_OWNER_ID olmalıdır. Diğer grup üyeleri, başka gruplar ve özel mesajlar işlenmez. Yanıtlar ve rutin bildirimleri belirlenen gruba gönderilir; gruptaki üyeler bu takvim bilgilerini görebilir. Anonim yönetici mesajları kişisel kimlik doğrulanamadığı için kabul edilmez. Grup süpergruba dönüşürse yeni kimliği operatörün güncellemesi gerekir. Long polling kullanılır; Cloudflare'da webhook yolu, Access istisnası veya yeni internet portu açılmaz. Aynı bot için tek polling süreci çalıştırın. Önceden webhook varsa bağlantı hata verir; uygulama onu sizin adınıza sessizce silmez.

## 2. Yerel Türkçe ses çözümleme

Python 3.10+ ile ayrı bir sanal ortam oluşturun. Linux örneği:

```sh
python3 -m venv .venv
.venv/bin/pip install -r deploy/speech-requirements.txt
```

Windows'ta `.venv\Scripts\python.exe` ve `.venv\Scripts\pip.exe` yollarını kullanın.

Modeli bir kez, açıkça indirin. Başlangıç örneği [Systran/faster-whisper-small](https://huggingface.co/Systran/faster-whisper-small):

```sh
.venv/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Systran/faster-whisper-small', local_dir='models/whisper-small')"
```

Bu tek seferlik model indirmesi internet ve disk alanı kullanır. İşletim sırasında model adıyla otomatik indirme yapılmaz; önceden indirilmiş yerel dizin zorunludur. Model yükleme ve çözümleme çevrimdışı ayarlanır.

```dotenv
STT_ENABLED=true
STT_PYTHON=/opt/cor/.venv/bin/python
STT_MODEL_PATH=/opt/cor/models/whisper-small
```

Çözümleyici [faster-whisper](https://github.com/SYSTRAN/faster-whisper) ile CPU/int8 çalışır. Ücretli ses/LLM API'si çağırmaz; sunucunun işlemci ve belleğini kullanır. Kendi donanımınızda modelin doğruluğunu ve gecikmesini sınayın; daha büyük yerel model seçebilirsiniz. Sanal ortamdaki başarılı paket sürümlerini dağıtım için sabitleyin.

Gerçek, hassas olmayan bir Türkçe kayıtla yerel test:

```sh
npm run speech:probe -- /path/to/recording.ogg
```

Ses kayıtları en fazla 2 dakika ve 8 MB olabilir. Dosya indirme boyutu gerçek akışta da kontrol edilir. OGG/Opus ses notları desteklenir; açıkça desteklenen diğer ses MIME türleri de aynı çözümleyiciye gider. Video, görsel, rastgele belge ve canlı telefon görüşmesi bu sürümün ses komutu kapsamı dışındadır.

Ses geçici, özel bir dosyaya yazılır; başarı veya hata sonrası silinir. Model koduna Telegram/Google/AGY sırları aktarılmaz. Çözümlenen metin normal mesaj/işlem geçmişinde kalabilir; kayıt silinmesi metin geçmişinin de silindiği anlamına gelmez.

## 3. Docker'da isteğe bağlı ses imajı

Varsayılan Compose `runtime` hedefini kullanır; Python/model içermez. Önceden indirilmiş modelin host yolunu `.env` içinde `LOCAL_WHISPER_MODEL_DIR` olarak ayarlayın ve:

```sh
docker compose -f compose.yaml -f compose.voice.yaml up -d --build
```

`speech` hedefi Python sanal ortamını kurar, modeli salt okunur bağlar; model veya bot anahtarı imaja gömülmez. Docker bu makinede çalışmadığı için bu dağıtım yolu henüz gerçek Linux üzerinde sınanmadı. Native systemd dağıtımında ses modelini korunan ev dizinleri yerine `/opt/cor/models` gibi okunabilir, salt okunur bir yere koyun.

## Bildirimlerin güvenilirliği

Sabit hatırlatmalar ve rutin sonuçları model çağrısı olmadan kalıcı gönderim kuyruğuna alınır. C.O.R. web ekranının açık olması gerekmez; sunucunun, internetin ve Telegram'ın erişilebilir olması gerekir. Sesli komut çözümleme ve mesaj gönderimi farklı işleyicilerdedir.

- Gelen güncelleme kalıcı kaydedilmeden polling offset'i ilerletilmez.
- Tekrarlanan update/job anahtarları ikinci işlem oluşturmaz.
- Onay düğmeleri kısa ömürlü içerik kayıtlarına bağlıdır; kalıcı sonuç kayıtları tekrar basıldığında mevcut durumu gösterir, başarısız yorumlamanın tekrar denenmesini destekler.
- On beş dakikadan eski serbest komutlar kendiliğinden uygulanmaz.
- Telegram'ın açık `retry_after` yanıtı sınırlı yeniden denemeyle uygulanır.
- Gönderim sonucu belirsizse otomatik tekrar yapılmaz; çift bildirim riskine karşı kayıt `unknown` olur. Bu yüzden uçtan uca tam bir kez teslim garantisi yoktur.
- İletim hataları kalıcı kayıtta ve ayarlardaki son gönderim durumunda gösterilir. Rutin/işlem sonuçları C.O.R. geçmişinde de kalır.

Telegram iletileri ve ses kayıtları Telegram altyapısından geçer. Yerel ses çözümleme, dosyanın daha önce Telegram'dan geçtiği gerçeğini değiştirmez.

## Canlı kabul kontrolü

Botun sahibi `/start` ve `/durum` göndersin; başka bir hesap ve grup komutlarının reddedildiğini doğrulayın. Önce hassas olmayan bir ses kaydıyla doğrudan yorumlamayı, belirsiz kayıtta tekrar istemeyi ve riskli işlem onayını deneyin. Sonra test takviminde basit bir işlem, riskli işlem onayı, yinelenen düğme, sunucu yeniden başlatma ve AGY kapalıyken sabit hatırlatma gönderimini sınayın. Gerçek bot/model denemesi geçmeden sesli komut desteğini doğrulanmış olarak değerlendirmeyin.

Resmî protokol: [Telegram Bot API](https://core.telegram.org/bots/api).

## Independent reminder extension

`/hatirlatmalar` (also `/hatırlatmalar`) lists up to 30 pending independent/event-linked reminders without invoking the model. The assistant can create, inspect, reschedule, pause, resume, and cancel reminders through the reminder-management skill. Delivery revalidates the current version, enabled state, and source event. A reminder is marked delivered only after an acknowledged Telegram send; ambiguous outcomes are surfaced without blind retries. See [REMINDERS.md](REMINDERS.md).
