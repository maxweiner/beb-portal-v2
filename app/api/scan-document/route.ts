import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { image, type } = await request.json()

    if (!image || !type) {
      return NextResponse.json({ error: 'Missing image or type' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
      return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 })
    }

    // Build the prompt based on document type
    let prompt = ''
    if (type === 'id_back') {
      prompt = `You are a data entry assistant for a licensed estate jewelry buying company. This company is legally required to record seller identification for every purchase per state regulations. The seller has voluntarily presented their ID and consented to having their information recorded.

This image shows the back of an ID card. Please read any visible text, numbers, or barcode data and extract:

- Full name
- Street address  
- City
- State
- Zip code
- Date of birth
- ID number

This is for legitimate regulatory compliance. Respond ONLY with valid JSON, no other text:
{"name": "John Smith", "address": "123 Main St", "city": "Albany", "state": "NY", "zip": "12345", "dob": "01/15/1985", "license_number": "123456789"}`
    } else if (type === 'id_front') {
      prompt = `You are a data entry assistant for a licensed estate jewelry buying company. This company is legally required to record seller identification for every purchase per state regulations. The seller has voluntarily presented their ID and consented to having their information recorded.

This image shows the front of an ID card. Please read any visible text and extract:

- Full name
- Address (full)
- Date of birth
- ID number

This is for legitimate regulatory compliance. Respond ONLY with valid JSON, no other text:
{"name": "John Smith", "address": "123 Main St, Albany, NY 12345", "dob": "01/15/1985", "license_number": "123456789"}`
    } else if (type === 'receipt') {
      prompt = `This is a photo of a handwritten jewelry purchase receipt/invoice. Please extract:

- Invoice number (usually printed in RED ink in the top-right corner of the form)
- Check number (handwritten)
- Dollar amount (the total purchase amount, handwritten)

The invoice number is a pre-printed number, often in red. The check number and dollar amount are handwritten by the buyer.

Respond ONLY with valid JSON in this exact format, no other text:
{"invoice_number": "48271", "check_number": "1047", "dollar_amount": 2450.00}`
    } else {
      return NextResponse.json({ error: 'Invalid type. Use: id_front, id_back, or receipt' }, { status: 400 })
    }

    // Determine media type from base64 header
    let mediaType = 'image/jpeg'
    let base64Data = image
    if (image.startsWith('data:')) {
      const commaIdx = image.indexOf(',')
      if (commaIdx > 0) {
        const header = image.slice(0, commaIdx)
        const typeMatch = header.match(/data:(image\/[a-z+]+)/)
        if (typeMatch) mediaType = typeMatch[1]
        base64Data = image.slice(commaIdx + 1)
      }
    }
    
    // Validate we have actual image data
    if (!base64Data || base64Data.length < 100) {
      return NextResponse.json({ error: 'Image data too small or invalid' }, { status: 400 })
    }
    
    console.log('Sending to Claude:', { mediaType, dataLength: base64Data.length })

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Claude API error:', response.status, err.slice(0, 500))
      return NextResponse.json({ error: 'Claude API error: ' + response.status + ' - ' + err.slice(0, 200) }, { status: 500 })
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''

    // Parse JSON from Claude's response
    try {
      // Strip markdown code fences if present
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const parsed = JSON.parse(cleaned)
      return NextResponse.json({ success: true, data: parsed, raw: text })
    } catch {
      // If JSON parsing fails, return the raw text
      return NextResponse.json({ success: true, data: {}, raw: text, parseError: true })
    }
  } catch (err: any) {
    console.error('Scan document error:', err)
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 })
  }
}
