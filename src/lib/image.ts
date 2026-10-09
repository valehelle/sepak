/** Longest side, in pixels, a receipt is shrunk to. Plenty to read a name,
 *  an amount and a time off a banking app's screenshot. */
const MAX_SIDE = 1600

/** A phone screenshot or photo, made small before upload: quicker on a
 *  weak connection and lighter on the free storage. Falls back to the
 *  original file when the browser cannot decode it here. */
export async function shrinkImage(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')
    if (context === null) return file
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    return blob ?? file
  } catch {
    return file
  }
}
