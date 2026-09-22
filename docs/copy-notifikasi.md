# Semua teks notifikasi

Every user-facing string in the notification feature, with where it appears.
Rewrite the **right-hand** column (or scribble on it) and hand it back —
I'll change the code and the migration to match.

Malay is what the group reads; the labels and headings here are for you.

---

## 1. Dalam Telegram

### The message that matters — the promotion itself

Three lines in one message, built in `sepak.promotion_text`
(`0014_telegram.sql`). The link is tappable.

| Part | Now |
|---|---|
| Line 1 | `Anda berjaya masuk!` |
| Line 2 | `Team A Merah — GK · Sesi 999, 28 Sep 8:00 PM` |
| Line 3 | `https://valehelle.github.io/sepak/s/<id>` |

Line 2's shape is: `Team <A/B/C> <nama team> — <posisi> · Sesi <no>, <tarikh> <masa>`.

### The bot's replies

| When | Now |
|---|---|
| Pressed Start with a good link | `Siap! Kami akan beritahu di sini sebaik sahaja anda naik dari senarai tunggu.` |
| Link expired or already used | `Pautan ni dah tamat tempoh. Buka halaman sesi dan tekan "Guna Telegram" sekali lagi.` |
| Pressed Start with no link at all (found the bot by searching) | `Buka pautan "Guna Telegram" dalam halaman sesi untuk sambung akaun ni.` |
| Sent `/stop` | `Dah berhenti. Anda tak akan dapat notifikasi dari kami lagi.` |

### Set in BotFather, not in code

| Field | Now |
|---|---|
| `/setdescription` | `Bot Geng Turun Peluh. Kami mesej anda di sini sebaik sahaja ada tempat untuk anda dari senarai tunggu — tak perlu duduk tunggu depan halaman sesi.` + `Sambung dari halaman sesi: tekan "Guna Telegram", dan Telegram akan buka sendiri.` |
| `/setabouttext` | `Notifikasi bila anda naik dari senarai tunggu Geng Turun Peluh.` |
| `/setcommands` | `stop - Berhenti terima notifikasi` |

---

## 2. Dalam halaman sesi

### The row in the left panel

Shown to a device that holds a slot or a queue place.

| Part | Now |
|---|---|
| Button | `Hidupkan notifikasi` |
| Under it | `Kami beritahu bila anda naik dari senarai tunggu.` |
| Once it is on | `✓ Notifikasi hidup untuk peranti ni.` |

### The sheet (opens by itself after joining the queue)

| Part | Now |
|---|---|
| Title | `Beritahu saya bila naik` |
| Opening line | `Slot boleh terbuka bila-bila masa. Kami boleh beritahu anda sebaik sahaja dapat tempat — tak perlu buka halaman ni tunggu.` |
| Main button | `Guna Telegram` |
| Under it | `Paling senang, dan jalan pada semua telefon.` |
| Second button | `Guna notifikasi telefon ni` |
| Under it | `Notifikasi terus pada peranti ni, tanpa app lain.` |
| Dismiss | `Tak perlu` |

### After Telegram opens

| Part | Now |
|---|---|
| Instruction | `Tekan Start dalam Telegram, lepas tu balik sini dan semak.` |
| Button | `Dah tekan Start` |
| While checking | `Menyemak…` |
| Second button | `Buka Telegram lagi` |

### When it worked

| Via | Now |
|---|---|
| Telegram | `Siap. Kami akan mesej anda dalam Telegram sebaik sahaja ada tempat.` |
| Browser | `Siap. Telefon ni akan dapat notifikasi sebaik sahaja ada tempat.` |
| Button | `Tutup` |

### Notes shown instead of the browser button

| When | Now |
|---|---|
| iPhone, app not installed | `Notifikasi terus pada iPhone perlu app ni dipasang di Home Screen dulu. Telegram tak perlu apa-apa pemasangan.` |
| Notifications blocked in browser settings | `Notifikasi browser disekat untuk laman ni dalam setting anda. Telegram masih boleh.` |

### When something goes wrong

| When | Now |
|---|---|
| Start not pressed yet | `Belum sambung. Tekan Start dalam Telegram, lepas tu semak semula.` |
| Could not make the link | `Gagal membuka Telegram.` |
| Not in the queue or a slot | `Sertai senarai tunggu dulu sebelum sambung Telegram.` |
| Bot not configured in the build | `Telegram belum disediakan.` |
| Link request failed | `Gagal menyediakan pautan Telegram.` |
| Browser permission refused | `Anda tak izinkan notifikasi.` |
| Browser notifications not set up in the build | `Notifikasi belum disediakan.` |
| Subscription came back incomplete | `Langganan notifikasi tak lengkap.` |
| Could not store the subscription | `Gagal menyimpan langganan notifikasi.` |
| Not in the queue or a slot (browser route) | `Sertai senarai tunggu dulu sebelum hidupkan notifikasi.` |
| Anything else while turning it on | `Gagal hidupkan notifikasi.` |

---

## 3. The phone notification itself (browser route, Android)

Same words as the Telegram message, shown as a system notification:
title `Anda berjaya masuk!`, body `Team A Merah — GK · Sesi 999, 28 Sep 8:00 PM`.
If a push ever arrives unreadable, the title falls back to
`Geng Turun Peluh`.
