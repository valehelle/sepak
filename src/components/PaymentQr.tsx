/** The organiser's DuitNow QR, served with the site (public/duitnow-qr.jpg).
 *  One account for every session for now; a per-session upload in the admin
 *  form would replace this if organisers ever collect into different ones. */
const QR_URL = `${import.meta.env.BASE_URL}duitnow-qr.jpg`

type PaymentQrProps = {
  /** The fee line as the session shows it ("RM 26/pax (GK RM 15)"). */
  fee: string
}

/** Where to pay, on the page everyone opens: the question after "am I in"
 *  is "where do I transfer". */
export function PaymentQr({ fee }: PaymentQrProps) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-3 text-center">
      <h2 className="font-kit text-[15px] font-semibold text-white">Bayaran</h2>
      <p className="mb-2 font-sans text-[13px] text-white/60">{fee}</p>
      <img src={QR_URL} alt="QR DuitNow untuk bayaran" className="mx-auto max-h-64 rounded-md bg-white" />
      <a
        href={QR_URL}
        download="duitnow-qr.jpg"
        className="mt-3 inline-block font-kit text-[14px] text-turf-lit underline decoration-turf-lit/40 underline-offset-4"
      >
        Simpan gambar QR
      </a>
      {/* A phone cannot scan its own screen: the QR has to go through the
          gallery. Nothing else on the page says so. */}
      <p className="mt-1 font-sans text-xs leading-relaxed text-white/50">
        Dalam app bank: Scan QR → pilih gambar dari galeri. Lepas bayar, tekan "Tandakan dah bayar".
      </p>
    </section>
  )
}
