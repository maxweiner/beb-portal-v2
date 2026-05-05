-- ── Trunk Comms phase 13: seed Confirmation Letter ───────────
-- Final phase. Inserts the Confirmation Letter template (subject
-- + full body from spec section 2d) and a 60-day-before-event
-- schedule. Phase 4's AFTER INSERT trigger on
-- communication_send_schedules will then auto-create per-show
-- checklist items for every future trunk show.
--
-- Idempotent: only seeds when no template named "Confirmation
-- Letter" exists. Re-running is a no-op so the operator can
-- include this in routine deploys without worry.
-- ============================================================

DO $$
DECLARE v_template_id UUID;
BEGIN
  -- Template
  IF NOT EXISTS (SELECT 1 FROM public.communication_templates WHERE name = 'Confirmation Letter') THEN
    INSERT INTO public.communication_templates (name, subject_line, body, is_active)
    VALUES (
      'Confirmation Letter',
      'Estate Trunk Show Confirmation — {store_name} — {event_dates_range}',
$body$BENEFICIAL ESTATE BUYERS
Estate Trunk Show
Confirmation Letter

Dear {store_name},

This letter is confirming your Estate Trunk Show with Beneficial Estate Buyers on {event_dates_range}.

We want to thank you for hosting this exceptional collection of fine antique and period estate jewelry. We're delighted to partner with you, and are looking forward to a successful and enjoyable event.

Here's what you can expect from us:
• We will bring a beautifully curated, fully tagged, and ready-to-sell line of goods.
• Our team will be on hand to help create the perfect atmosphere for showcasing estate jewelry in your showroom.
• With our extensive knowledge and passion for the history and craftsmanship of each piece, we'll support your clients in connecting with and falling in love with the collection.

Logistics:
• Setup and preparatory work will be handled by our team, although your staff's support is always appreciated. Our representative will arrive either the day before the event or the morning of the event.

Pricing:
• Items sold from $0.01 to $3,000.00: your cost is 50% of the item sold.
• Items sold from $3,001.00 to $19,999: your cost is 60% of the item sold.
• Items sold at $20,000 and above: your cost is 65% of the item sold.

Payment:
• Full payment is due at the end of the event to Beneficial Estate Buyers.

Price Points:
• Our price points range from $250 to $60,000, with a primary retail range of $900–$4,000.
• The average total retail event value is approximately $40,000+.

Your Role:
• Market the Trunk Show as a special opportunity for your clientele to explore unique jewelry not typically available in stores.
• Leverage personal outreach — emails, mailers, follow-up calls, and social media — to generate excitement.
• Prioritize clients who appreciate jewelry and are likely to make self-purchases of $1,000 or more.
• We will provide 500 4.25" x 6" postcards, one 24" x 36" poster, two counter cards, and several social media/text/email files at no cost.
• Please allocate 25–30 feet of showcase space, along with any available display forms, for the day of setup.
• Ensure space in your vault for storing the collection when not on display.

We kindly request that our merchandise be the sole focus during the Estate Trunk Show event, with no other vendor items or outside vendor merchandise displayed.

Additionally, if your store has showcases of Estate Jewelry, we ask that these items not be on sale during the duration of our event.

If you are planning a large event involving multiple vendors, please inform us in advance so that we can make the necessary preparations to ensure its success.

Marketing Materials & Postcards:
Feel free to order your postcards now via the link below. It takes approximately two weeks from proof approval to receive the materials. Proofs will come from proof@creativepromarketing.com.

https://www.creativepromarketing.com/marketing-for-jewelers/
Password: reddiamond

Special Note:
To help ensure the strongest possible turnout, we kindly encourage placing your postcard order within the recommended timeline of 2 months prior to your event. Timely mailings consistently help drive store traffic and create excitement for the event. While we provide these postcards at no charge, staying on schedule allows us to continue offering them as a complimentary service.

In the rare event that postcards are ordered late and we incur additional printing or rush fees, we may need to deduct those costs from the final event commission. Our intention is simply to keep everything running smoothly and support a highly successful event for you. We truly appreciate your partnership and teamwork in meeting these shared deadlines.

If you have any questions or need assistance at any stage, we're here to help. We look forward to a wonderful event together!

Additional Resources:
• Jewelry Photos & Additional Tools:
https://www.dropbox.com/scl/fo/g57jmot62hryzih2434f8/AKXcsKIAjL8AGsy4sY4N67w?rlkey=vfgrr2n3iew7pjkkmqu3uebhi&st=nond2d2u&dl=0

For questions, feel free to contact {rep_name} at {rep_phone} or {rep_email}.
You may also reach our marketing director, Krista Blundell, at kristaoblundell@gmail.com$body$,
      true
    )
    RETURNING id INTO v_template_id;

    -- 60-day schedule. Phase 4's INSERT trigger will fan this
    -- out to every future trunk show automatically.
    INSERT INTO public.communication_send_schedules
      (template_id, days_before_event_start, send_window_days, is_active)
    VALUES (v_template_id, 60, 7, true);

    RAISE NOTICE 'Seeded Confirmation Letter template + 60-day schedule.';
  ELSE
    RAISE NOTICE 'Confirmation Letter already exists; skipping seed.';
  END IF;
END $$;
