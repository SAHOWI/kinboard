# Kinboard — Functional Requirements Document (FRD)

| Item | Value |
|---|---|
| Version | 0.1 (draft) |
| Date | 2026-11-25 |
| Status | For review |
| Related | `00-product-analysis.md`, `02-technical-specification.md` |

---

## 1. Purpose and scope

Kinboard is a **family organisation system** made of three parts:

1. **Home Display**: a wall-mounted or tabletop touchscreen (10–27", primary target 15.6" FHD landscape) that is always on in a shared space.
2. **Mobile App**: an iOS and Android companion app for every family member who has a phone.
3. **Kinboard Server**: a synchronisation backend, available as a hosted service **or self-hosted**.

The system centralises the family calendar, tasks, routines, lists, meal plans and rewards, so that the
whole family, including children, takes part in organising daily life.

### 1.1 Out of scope (v1)
Video calls, smart-home control, payments, and e-commerce integrations such as online grocery ordering.

## 2. Definitions

| Term | Meaning |
|---|---|
| **Household** | The tenant: one family, with one or more displays and N members |
| **Member** | A person in the household. Has a role, colour and avatar, and may or may not have a login |
| **Adult / Child role** | Permission levels. Children have restricted edit rights |
| **Display** | A paired physical screen device |
| **External calendar** | A Google, Microsoft 365/Outlook, iCloud/CalDAV or ICS feed linked to a member |
| **Routine** | A recurring set of tasks tied to a time of day (morning, evening …) |
| **Points** | A reward currency earned by completing tasks |

## 3. User roles and personas

| Role | Persona | Main goals |
|---|---|---|
| **Household admin (adult)** | "Anna, 38, does most of the planning" | Share the mental load, see everything at a glance, delegate tasks |
| **Adult member** | "Tom, 40, works shifts" | Get notified about changes, add events from the phone |
| **Child (6–14)** | "Mia, 8" | See what happens today, tick off routines, earn rewards. Must not break anything |
| **Child (pre-reader, 3–6)** | "Ben, 5" | Picture-based routines and big touch targets |
| **Guest / caregiver** (phase 2) | Grandparent, nanny | Limited, time-bound access |

## 4. Priority scheme

- **M** = Must (MVP) · **S** = Should (v1.0) · **C** = Could (v1.x) · **W** = Won't (for now)

---

## 5. Functional requirements

### 5.1 Household, members and onboarding (HH)

| ID | Requirement | Prio |
|---|---|---|
| FR-HH-01 | An adult can create a household with a name, time zone, locale (de/en at launch) and week start day. | M |
| FR-HH-02 | An admin can add members with a name, role (adult/child), colour (from an accessible palette) and an avatar (photo or emoji). | M |
| FR-HH-03 | Members without a phone (e.g. small children) exist as profiles without a login. | M |
| FR-HH-04 | An admin can invite adults by link or e-mail. Invitees join through the mobile app. | S |
| FR-HH-05 | On first boot a display shows a **pairing QR code and a short code**. Scanning it in the app links the display to the household (device-code flow). | M |
| FR-HH-06 | A household can have several displays (e.g. kitchen and hallway), each with its own layout settings. | S |
| FR-HH-07 | An admin can remove a display remotely. This revokes its credentials and wipes cached data. | M |
| FR-HH-08 | An admin can set an **adult PIN** that unlocks protected actions on the display. | M |

### 5.2 Calendar (CAL)

| ID | Requirement | Prio |
|---|---|---|
| FR-CAL-01 | Show events in **Day, Week (columns per day), Agenda and Month** views. The default view can be set per display. | M |
| FR-CAL-02 | A **"Family Day" view** shows one column per member for today. | S |
| FR-CAL-03 | Events show the colour and avatar of each assigned member. Multi-member events show all avatars. | M |
| FR-CAL-04 | Events can be filtered by member (toggle avatars). | M |
| FR-CAL-05 | Events can be created, edited and deleted on the display and in the app: title, all-day or start/end, members, location, notes, recurrence and reminders. | M |
| FR-CAL-06 | Recurring events follow RFC 5545 rules (daily/weekly/monthly/yearly, by weekday, until/count, exceptions). | M |
| FR-CAL-07 | Each member can **link external calendars**: Google, Microsoft 365/Outlook.com, iCloud (CalDAV with an app password), generic CalDAV, and read-only ICS/webcal URLs. Setup takes 5 minutes or less. | M (ICS + CalDAV) / S (Google, MS OAuth) |
| FR-CAL-08 | Sync is two-way where the provider allows it. Edits made on Kinboard to a synced event are written back to the source. | S |
| FR-CAL-09 | External changes appear on all clients within **≤ 60 s** (push or webhook where available, otherwise polling). | M |
| FR-CAL-10 | External calendar data is **not stored on the display** beyond a short, encrypted cache window (default ±14 days) for offline display. | M |
| FR-CAL-11 | Public holidays and school holidays per region (DE/AT/CH states and cantons) can be shown as an overlay. | S |
| FR-CAL-12 | **School timetables** per child: a weekly lesson grid with A/B weeks, shown as a widget. | C |
| FR-CAL-13 | Event conflicts for the same member are highlighted. | C |

### 5.3 Reminders and notifications (NOT)

| ID | Requirement | Prio |
|---|---|---|
| FR-NOT-01 | An event or task reminder can trigger a **sound and a banner on the display**, a **push notification** on the assigned members' phones, or both. | M |
| FR-NOT-02 | When an adult adds or changes an event that involves other adults, those adults are notified ("Tom added: Parents' evening, Thu 19:00"). Each user can switch this off. | S |
| FR-NOT-03 | Each user can set quiet hours. The display follows its own quiet hours (no sound). | S |
| FR-NOT-04 | A daily digest notification ("Today: 3 events, 5 tasks") is sent at a time the user chooses. | C |

### 5.4 Tasks, chores and routines (TSK)

| ID | Requirement | Prio |
|---|---|---|
| FR-TSK-01 | Create tasks with a title, an optional icon or emoji, assignee(s), a due date/time, recurrence and a point value. | M |
| FR-TSK-02 | Group tasks into **routines** (e.g. "Morning", "Evening") with a time window. During the window, the display highlights the active routine. | M |
| FR-TSK-03 | Members tick off their own tasks on the display with **one tap**. A celebratory animation follows (can be switched off). | M |
| FR-TSK-04 | Children can complete, but not create or delete, tasks unless the PIN is entered. | M |
| FR-TSK-05 | Tasks can require **parent approval** before points are credited. | S |
| FR-TSK-06 | Open tasks can be shown per member as a progress ring (e.g. 3/5 done). | M |
| FR-TSK-07 | Tasks can be added from the app and appear on the display in real time. | M |
| FR-TSK-08 | Picture-only mode for pre-readers (large icons, no text required). | S |

### 5.5 Points and rewards (RWD)

| ID | Requirement | Prio |
|---|---|---|
| FR-RWD-01 | Completing a task credits its points to the member. | M |
| FR-RWD-02 | Adults define rewards (title, icon, point cost). | M |
| FR-RWD-03 | A child can **request to redeem** a reward on the display or in the app. An adult approves it, and the points are deducted. | M |
| FR-RWD-04 | Each member's point history (ledger) is viewable and can be corrected by an adult (with an audit entry). | S |
| FR-RWD-05 | Savings goals: a progress bar towards a chosen reward. | C |

### 5.6 Lists (LST)

| ID | Requirement | Prio |
|---|---|---|
| FR-LST-01 | Unlimited lists, each with a name, icon and type (shopping, to-do, packing, generic). | M |
| FR-LST-02 | Add, check off, uncheck, reorder and delete items. Changes sync in real time to all clients, so items can be ticked off in the shop. | M |
| FR-LST-03 | Shopping items can have a quantity and are grouped automatically by store category. | S |
| FR-LST-04 | **Private or hidden lists**: visible only to selected members (e.g. gift lists). Hidden lists never appear on the shared display. | M |
| FR-LST-05 | Lists keep working offline in the app and sync when the connection returns (conflict-free merge). | S |
| FR-LST-06 | Quick-add on the display with an on-screen keyboard and recently used item suggestions. | M |

### 5.7 Meal planning and recipes (MEAL)

| ID | Requirement | Prio |
|---|---|---|
| FR-MEAL-01 | A weekly meal plan grid (breakfast, lunch, dinner; slots can be configured). | S |
| FR-MEAL-02 | Store recipes with a title, photo, servings, ingredients and steps. Recipes can be imported from a URL (schema.org/Recipe). | S |
| FR-MEAL-03 | Add a recipe's ingredients to a shopping list in one tap, with quantities scaled to the servings. | S |
| FR-MEAL-04 | Today's dinner is shown as a widget on the home screen. | S |

### 5.8 Photo frame and standby (PHO)

| ID | Requirement | Prio |
|---|---|---|
| FR-PHO-01 | Upload photos from the app into household albums. | S |
| FR-PHO-02 | After N minutes idle (configurable), the display shows a photo slideshow with the clock and the next event overlaid. | S |
| FR-PHO-03 | A schedule controls when the screen is on, dimmed or off (e.g. off 22:00–06:00). Touch wakes it. | M |
| FR-PHO-04 | A **privacy mode** hides calendar content (e.g. when guests are present). | C |

### 5.9 Home screen and widgets (WID)

| ID | Requirement | Prio |
|---|---|---|
| FR-WID-01 | The home screen combines a clock and date, **today's agenda**, **routines/tasks per member**, weather and the next meal. | M |
| FR-WID-02 | Weather comes from an open data source (e.g. Open-Meteo or MET Norway) for the household's location. | S |
| FR-WID-03 | Adults can show, hide and reorder widgets per display. | C |
| FR-WID-04 | A family message board / sticky note ("Note on the fridge"). | C |

### 5.10 Assistant — "Ask Kinboard" (AI) — optional module

| ID | Requirement | Prio |
|---|---|---|
| FR-AI-01 | Natural-language quick-add (typed or spoken), e.g. "Football for Ben every Tuesday 5 pm". It is parsed into a draft event or task that the user confirms. | C |
| FR-AI-02 | Photo import: a picture of a school letter or invitation yields draft events. | C |
| FR-AI-03 | All AI processing can run on a **self-hosted local model**. Nothing leaves the household server unless the admin opts in. | C |

### 5.11 Mobile app (APP)

| ID | Requirement | Prio |
|---|---|---|
| FR-APP-01 | Feature parity with the display for calendar, tasks, lists, rewards and meals. | M |
| FR-APP-02 | Sign in with e-mail and password or a magic link. Passkeys are optional. | M |
| FR-APP-03 | Pair a display by scanning its QR code. | M |
| FR-APP-04 | Push notifications (APNs, FCM; UnifiedPush on de-Googled Android). | M |
| FR-APP-05 | Home-screen widget showing today's agenda (iOS/Android). | C |
| FR-APP-06 | Manage external calendar connections and display settings. | M |

### 5.12 Administration and settings (ADM)

| ID | Requirement | Prio |
|---|---|---|
| FR-ADM-01 | Display settings: orientation, brightness schedule, sound volume, default view, language, theme (light/dark/auto). | M |
| FR-ADM-02 | Over-the-air updates for the display, installed automatically in a maintenance window with rollback on failure. | M |
| FR-ADM-03 | Export all household data (JSON + ICS) and delete the household (GDPR Art. 15, 17, 20). | M |
| FR-ADM-04 | An audit log of admin actions. | S |

---

## 6. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Usability | Touch targets ≥ 48 px (≥ 64 px in child mode). Core actions take ≤ 2 taps from the home screen. Readable from 2 m (base font ≥ 18 px on 15.6" FHD). |
| NFR-02 | Accessibility | WCAG 2.2 AA contrast. Member colours are never the only distinguishing feature (avatar or initials as well). |
| NFR-03 | Performance | Display cold boot to usable UI in ≤ 30 s. View switch ≤ 200 ms. 60 fps scrolling on a Raspberry Pi 5-class device. |
| NFR-04 | Realtime | A local change appears on other clients in ≤ 2 s (p95) when online. |
| NFR-05 | Offline | The display shows cached data and accepts task check-offs offline, then syncs when the connection returns. |
| NFR-06 | Availability | 99.5 % monthly for the hosted service. The display degrades gracefully. |
| NFR-07 | Security | TLS 1.3 everywhere. Device credentials can be revoked. Passwords hashed with Argon2id. OAuth tokens encrypted at rest (AES-256-GCM). Follows the OWASP ASVS L2 checklist. |
| NFR-08 | Privacy | GDPR compliant. EU hosting. Data minimisation. No third-party trackers. Children's data is never used for profiling. |
| NFR-09 | Power | Display draws ≤ 10 W in normal operation and ≤ 1 W with the screen off. |
| NFR-10 | Openness | All components use OSI-approved open-source licences. The server can be self-hosted with one `docker compose up`. |
| NFR-11 | i18n | German and English at launch, ICU message format, locale-aware dates and 24 h/12 h time. |
| NFR-12 | Maintainability | ≥ 70 % unit-test coverage on shared domain logic. E2E tests cover the critical flows. |

## 7. Key user flows (acceptance level)

1. **First setup**: Unbox the display → it shows a QR code → the adult installs the app, creates the household and scans the code → the display shows the household home screen. *Target: ≤ 5 min.*
2. **Link Google calendar**: App → Member → Calendars → Google → OAuth consent → choose calendars → events appear on the display within 60 s.
3. **Morning routine**: 07:00, the "Morning" routine is highlighted → Mia taps "Brush teeth" ✓ → confetti, +5 pts → the progress ring updates on the display and in Anna's app.
4. **Shopping**: Tom adds "Milk" on the display → Anna sees it in her app at the supermarket and ticks it off → it is crossed off on the display.
5. **Reward**: Mia has 120 pts → requests "Ice cream trip (100)" → Anna gets a push and approves it → the balance shows 20.

## 8. Release plan

| Release | Content |
|---|---|
| **MVP (alpha)** | HH-01/02/03/05/08, CAL-01/03/04/05/06/07 (ICS+CalDAV), CAL-09/10, TSK-01–04/06/07, RWD-01–03, LST-01/02/04/06, PHO-03, WID-01, APP-01–03, ADM-01 |
| **v1.0** | Google and Microsoft OAuth sync, push notifications, meal planning, photo frame, OTA updates, data export |
| **v1.x** | Assistant module, timetables, widgets editor, guests, Home Assistant integration |
