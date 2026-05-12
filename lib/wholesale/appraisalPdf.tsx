// Single-item appraisal PDF — Liberty-branded. Full specs, photos,
// insurance value as the headline replacement value, signature block.

import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'

export interface AppraisalPdfData {
  brand: string
  brandFullName: string
  brandLogoDataUrl?: string | null
  brandAddress?: string | null
  brandPhone?: string | null
  brandEmail?: string | null
  appraiser_name?: string | null
  prepared_at: string

  item: {
    item_number: string
    category: 'jewelry' | 'watch' | 'diamond'
    gender?: 'Female' | 'Male' | 'Unisex' | null
    public_notes?: string | null
    insurance_value_cents?: number | null
    // jewelry
    jewelry_type?: string | null
    jewelry_metal_type?: string | null
    jewelry_metal_color?: string | null
    jewelry_metal_karat?: string | null
    jewelry_metal_dwt?: number | null
    // Stones moved to a child table in supabase-migration-jewelry-stones-table.sql.
    // Caller is expected to pre-fetch and pass them in here for inclusion
    // in the appraisal spec table.
    stones?: Array<{
      stone_type: string
      shape: string | null
      count: number | null
      total_ct: number | null
      sort_order: number
    }>
    jewelry_size?: string | null
    jewelry_length?: string | null
    jewelry_hallmarks?: string | null
    jewelry_designer?: string | null
    jewelry_period?: string | null
    // watch
    watch_brand?: string | null
    watch_model?: string | null
    watch_serial_number?: string | null
    watch_band_style?: string | null
    watch_movement_type?: string | null
    watch_year?: number | null
    watch_condition?: string | null
    watch_box_papers?: string | null
    watch_complications?: string[] | null
    watch_case_material?: string | null
    watch_case_size_mm?: number | null
    watch_dial_color?: string | null
    // diamond
    diamond_lab_type?: string | null
    diamond_report_number?: string | null
    diamond_shape?: string | null
    diamond_carat?: number | null
    diamond_color?: string | null
    diamond_clarity?: string | null
    diamond_cut?: string | null
    diamond_polish?: string | null
    diamond_symmetry?: string | null
    diamond_fluorescence?: string | null
    diamond_measurements?: string | null
    diamond_depth_pct?: number | null
    diamond_table_pct?: number | null
  }
  photos: string[] // data URLs (up to 4 fits comfortably on one page)
}

const styles = StyleSheet.create({
  page:        { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#1a1a16' },
  hdrRow:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  brandName:   { fontSize: 16, fontWeight: 700 },
  brandLine:   { fontSize: 9, color: '#444' },
  docTitle:    { fontSize: 22, fontWeight: 700, color: '#10261c' },
  metaLine:    { fontSize: 10 },
  itemHdr:     { fontSize: 14, fontWeight: 700, marginTop: 6, marginBottom: 2 },
  description: { fontSize: 11, marginBottom: 10 },
  photosRow:   { flexDirection: 'row', gap: 6, marginBottom: 12 },
  photoCell:   { width: 130, height: 130, borderWidth: 1, borderColor: '#ccc' },
  photo:       { width: '100%', height: '100%', objectFit: 'cover' },
  specs:       { borderWidth: 1, borderColor: '#000', marginBottom: 12 },
  specRow:     { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#999' },
  specKey:     { width: '40%', padding: 4, fontWeight: 700, backgroundColor: '#f5f5f0' },
  specVal:     { width: '60%', padding: 4 },
  valueBox:    { padding: 12, borderWidth: 2, borderColor: '#10261c', backgroundColor: '#f5f5f0', textAlign: 'center', marginBottom: 14 },
  valueLbl:    { fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 1 },
  valueAmt:    { fontSize: 28, fontWeight: 700, color: '#10261c' },
  para:        { fontSize: 9, color: '#444', marginBottom: 8, lineHeight: 1.4 },
  signRow:     { marginTop: 24, flexDirection: 'row', gap: 12 },
  signCell:    { flex: 1 },
  signLine:    { borderBottomWidth: 0.5, borderBottomColor: '#000', height: 22 },
  signLbl:     { fontSize: 8, color: '#444', marginTop: 4 },
})

const fmtMoney = (c: number | null | undefined) =>
  c == null ? '—' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate  = (iso: string) => new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso)
  .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

const DEFAULT_APPRAISAL_LANG =
  'This document represents our professional opinion of the replacement value of the item described above for ' +
  'insurance purposes only. The value reflects an estimate of what it would cost to replace the item with one of ' +
  'comparable kind and quality at the date shown. This appraisal is not a guarantee of value and should not be ' +
  'interpreted as such. The appraised value is based on a physical examination of the item and on industry knowledge.'

export function AppraisalPdfDoc({ data }: { data: AppraisalPdfData }) {
  const { item } = data
  const specs: Array<[string, string]> = []
  specs.push(['Item #', item.item_number])
  specs.push(['Category', item.category])
  if (item.gender) specs.push(['Gender', item.gender])
  if (item.category === 'jewelry') {
    if (item.jewelry_type) specs.push(['Type', item.jewelry_type])
    if (item.jewelry_metal_type)  specs.push(['Metal', `${item.jewelry_metal_color || ''} ${item.jewelry_metal_karat || ''} ${item.jewelry_metal_type}`.trim()])
    if (item.jewelry_metal_dwt) specs.push(['Metal weight', `${item.jewelry_metal_dwt} dwt`])
    // Stones: one spec row per stone entry. Diamonds-first ordering
    // matches the Autofill description rule so the PDF and the public
    // notes line read the same way. Each value reads like
    // "Round, 5 stones, 0.50 ct tw" with blanks omitted.
    const sortedStones = [...(item.stones || [])].sort((a, b) => {
      const ga = a.stone_type === 'Diamond' ? 0 : 1
      const gb = b.stone_type === 'Diamond' ? 0 : 1
      if (ga !== gb) return ga - gb
      return a.sort_order - b.sort_order
    })
    for (const s of sortedStones) {
      const bits: string[] = []
      if (s.shape)    bits.push(s.shape)
      if (s.count)    bits.push(`${s.count} stone${s.count === 1 ? '' : 's'}`)
      if (s.total_ct) bits.push(`${s.total_ct} ct tw`)
      if (bits.length > 0) specs.push([s.stone_type, bits.join(', ')])
    }
    if (item.jewelry_size)   specs.push(['Size', item.jewelry_size])
    if (item.jewelry_length) specs.push(['Length', item.jewelry_length])
    if (item.jewelry_hallmarks) specs.push(['Hallmarks', item.jewelry_hallmarks])
    if (item.jewelry_designer)  specs.push(['Designer / maker', item.jewelry_designer])
    if (item.jewelry_period)    specs.push(['Period / era', item.jewelry_period])
  } else if (item.category === 'watch') {
    if (item.watch_brand)   specs.push(['Brand', item.watch_brand])
    if (item.watch_model)   specs.push(['Model', item.watch_model])
    if (item.watch_serial_number) specs.push(['Serial #', item.watch_serial_number])
    if (item.watch_year)    specs.push(['Year', String(item.watch_year)])
    if (item.watch_movement_type) specs.push(['Movement', item.watch_movement_type])
    if (item.watch_band_style)    specs.push(['Band', item.watch_band_style])
    if (item.watch_case_material) specs.push(['Case material', item.watch_case_material])
    if (item.watch_case_size_mm)  specs.push(['Case size', `${item.watch_case_size_mm} mm`])
    if (item.watch_dial_color)    specs.push(['Dial', item.watch_dial_color])
    if (item.watch_condition)     specs.push(['Condition', item.watch_condition])
    if (item.watch_box_papers)    specs.push(['Box & papers', item.watch_box_papers])
    if (item.watch_complications && item.watch_complications.length > 0)
      specs.push(['Complications', item.watch_complications.join(', ')])
  } else {
    if (item.diamond_lab_type)      specs.push(['Lab', item.diamond_lab_type])
    if (item.diamond_report_number) specs.push(['Report #', item.diamond_report_number])
    if (item.diamond_shape)         specs.push(['Shape', item.diamond_shape])
    if (item.diamond_carat != null) specs.push(['Carat', String(item.diamond_carat)])
    if (item.diamond_color)         specs.push(['Color', item.diamond_color])
    if (item.diamond_clarity)       specs.push(['Clarity', item.diamond_clarity])
    if (item.diamond_cut)           specs.push(['Cut', item.diamond_cut])
    if (item.diamond_polish)        specs.push(['Polish', item.diamond_polish])
    if (item.diamond_symmetry)      specs.push(['Symmetry', item.diamond_symmetry])
    if (item.diamond_fluorescence)  specs.push(['Fluorescence', item.diamond_fluorescence])
    if (item.diamond_measurements)  specs.push(['Measurements', item.diamond_measurements])
    if (item.diamond_depth_pct != null) specs.push(['Depth %', String(item.diamond_depth_pct)])
    if (item.diamond_table_pct != null) specs.push(['Table %', String(item.diamond_table_pct)])
  }

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.hdrRow}>
          <View>
            {data.brandLogoDataUrl ? (
              <Image src={data.brandLogoDataUrl} style={{ width: 180, height: 60, objectFit: 'contain', objectPosition: 'left center', marginBottom: 4 }} />
            ) : null}
            <Text style={styles.brandName}>{data.brandFullName}</Text>
            {data.brandAddress ? <Text style={styles.brandLine}>{data.brandAddress}</Text> : null}
            {data.brandPhone   ? <Text style={styles.brandLine}>{data.brandPhone}</Text>   : null}
            {data.brandEmail   ? <Text style={styles.brandLine}>{data.brandEmail}</Text>   : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.docTitle}>APPRAISAL</Text>
            <Text style={styles.metaLine}>Date {fmtDate(data.prepared_at)}</Text>
            <Text style={styles.metaLine}>{item.item_number}</Text>
          </View>
        </View>

        {item.public_notes ? <Text style={styles.description}>{item.public_notes}</Text> : null}

        {data.photos.length > 0 ? (
          <View style={styles.photosRow}>
            {data.photos.slice(0, 4).map((p, i) => (
              <View key={i} style={styles.photoCell}>
                <Image src={p} style={styles.photo} />
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.specs}>
          {specs.map(([k, v], i) => (
            <View key={i} style={styles.specRow}>
              <Text style={styles.specKey}>{k}</Text>
              <Text style={styles.specVal}>{v || '—'}</Text>
            </View>
          ))}
        </View>

        <View style={styles.valueBox}>
          <Text style={styles.valueLbl}>Replacement Value for Insurance</Text>
          <Text style={styles.valueAmt}>{fmtMoney(item.insurance_value_cents)}</Text>
        </View>

        <Text style={styles.para}>{DEFAULT_APPRAISAL_LANG}</Text>

        <View style={styles.signRow}>
          <View style={styles.signCell}>
            <View style={styles.signLine} />
            <Text style={styles.signLbl}>Appraiser{data.appraiser_name ? ` — ${data.appraiser_name}` : ''}</Text>
          </View>
          <View style={styles.signCell}>
            <View style={styles.signLine} />
            <Text style={styles.signLbl}>Date</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
