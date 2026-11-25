# Product Analysis — Dæly "Calendar" Family Planner (Reference Product)

> Working codename for our product: **Kinboard**
> Analysis date: 2026-11-25 · Source: daely-shop.com landing page, third-party reviews

## 1. Positioning

Dæly sells a **wall-mounted / tabletop touchscreen family organiser** plus a free companion app.
The core promise in the slogan *"Frag nicht Mama, frag Dæly®"* ("Don't ask Mum, ask Dæly") is to move
the family's **mental load** off one person and onto a shared, always-visible screen, so that
*"plötzlich alle sich beteiligen"* (suddenly **everyone** takes part). The marketing pillars visible in the
screenshot are **"Simpel."** (simple) and **"Für alle."** (for everyone, including children).

There is **no AI feature** behind "frag Dæly"; it is a slogan.

## 2. Hardware

| Aspect | Observation |
|---|---|
| Screen | 15.6" Full-HD capacitive touchscreen |
| Mounting | Wall mount **and** stand both included |
| Power | Mains only, no battery (by design), PSU ≤ 24 W, a few watts in use |
| Power modes | Sleep schedule or switch-off |
| Connectivity | Wi-Fi required for sync; cached data visible offline |
| Onboarding | Shows a QR code on first boot that leads to the app install and pairing |

## 3. Feature inventory

| # | Feature area | Functions observed | Notes for our product |
|---|---|---|---|
| F1 | **Calendar** | Day/week/month views; per-member colours and avatars; connect Google, Apple (iCloud), Outlook and other online calendars per member in about 5 minutes; real-time sync; events can be created on the device | Synced third-party data is **not stored on the device** (privacy claim). Two-way sync is implied. |
| F2 | **Family profiles** | Member colour and photo; adults and children | Basis for colour-coding everything |
| F3 | **Child edit protection** | Kids can read but not change the calendar; a "child lock" | Needs role-based permissions and an adult PIN |
| F4 | **Reminders and notifications** | Sound on the device and/or push to phone; partner is notified when an event is added | Multi-channel notifications |
| F5 | **To-dos and routines** | Shared tasks, recurring routines (e.g. evening routine, chores); members check tasks off themselves; tasks can be created from the app | Strong focus on kids doing tasks on their own |
| F6 | **Points and rewards** | Points per to-do; parents define rewards; kids redeem points | Gamification loop |
| F7 | **Lists** | Unlimited lists (shopping, packing, goals, projects); check off in the app while shopping; hidden gift lists | Lists need per-member visibility (gift lists hidden from some members) |
| F8 | **Meal planning** | Recipe storage, weekly meal plan, ingredients added to the shopping list | Recipe → shopping list link |
| F9 | **Photo frame** | Screensaver / standby mode with favourite photos uploaded from the app | Idle-time mode |
| F10 | **Timetables / widgets** | School timetables, widgets (e.g. weather, clock) | Widget framework |
| F11 | **Companion app** | Free iOS + Android app that covers most device functions | Parity is a key requirement |
| F12 | **Business model** | One-off hardware purchase, **no subscription**; optional paid add-ons later; free updates | Our architecture must keep running costs per household low |
| F13 | **Privacy** | Servers in Germany, GDPR | We go further: **self-hostable, open source** |

## 4. Competitive landscape (short)

| Product | Differentiator |
|---|---|
| Skylight Calendar | Market leader in the US, subscription for premium features |
| Hearth Display | 27" screen, AI SMS assistant (subscription) |
| DAKboard | Bring your own hardware, highly customisable layouts |
| Airzeen | 10.1", AI import of events from photos as a paid add-on |
| DIY (Home Assistant + tablet) | Flexible but hard to set up for families |

## 5. Opportunities for Kinboard

1. **Open source and self-hostable**: no cloud lock-in, which builds trust with privacy-focused DACH families.
2. **Local AI assistant** (the real "ask Kinboard"): natural-language capture, e.g. *"Dentist for Mia next Tuesday at 3"*, and events read from photos of school letters, running on a **local LLM**. This is an optional phase-2 module.
3. **Bring your own hardware**: runs on a Raspberry Pi 5, an old tablet, or a commercial panel.
4. **Home Assistant integration** (optional): show the device on smart-home dashboards and use presence information.
