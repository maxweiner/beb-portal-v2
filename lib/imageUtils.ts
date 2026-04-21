/**
 * Compress and resize an image from a File.
 * Returns a base64 data URL (image/jpeg).
 */
export async function compressImage(
  source: File | string,
  maxWidth = 1200,
  quality = 0.7
): Promise<string> {
  // If source is a File, read it first
  const dataUrl: string = await new Promise((resolve, reject) => {
    if (typeof source === 'string') {
      resolve(source)
    } else {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(source)
    }
  })

  // Now load it as an image
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        let { width, height } = img

        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width))
          width = maxWidth
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, width, height)

        const result = canvas.toDataURL('image/jpeg', quality)
        resolve(result)
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

/**
 * Upload a base64 image to Supabase Storage and return the public URL.
 */
export async function uploadToStorage(
  supabase: any,
  base64DataUrl: string,
  folder: string,
  filename: string
): Promise<string> {
  const res = await fetch(base64DataUrl)
  const blob = await res.blob()

  const path = `${folder}/${filename}`
  const { error } = await supabase.storage
    .from('receipt-images')
    .upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    })

  if (error) throw error

  const { data } = supabase.storage
    .from('receipt-images')
    .getPublicUrl(path)

  return data.publicUrl
}
