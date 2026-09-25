# Google Business Profile – MVP capability audit

Audit date: 2026-09-25. The implementation deliberately uses Business
Information v1 and Account Management v1 for profile/account data. The legacy
v4 API is retained only for reviews and media, which have not moved to those
APIs. An API capability is not the same as permission for every location:
metadata, category, country and verification state can make a field read-only.

| Function | Read | Write | API / endpoint | Before | MVP action |
|---|---:|---:|---|---|---|
| Accounts | yes | no | Account Management v1 `GET /v1/accounts` | yes | retain |
| Locations / profile fields | yes | patchable fields | Business Information v1 `accounts.locations.list`, `locations.get`, `locations.patch` | partial | full read mask; allowlisted minimal update mask; read-after-write |
| Google serving updates | yes | user decision only | Business Information v1 `locations.getGoogleUpdated` | no | persist proposal and `diffMask`; never auto-accept |
| Categories | yes | conditional | Business Information v1 categories + location patch | name only | persist full resource; patch only API options |
| Attributes | yes | conditional, separate endpoint | Business Information v1 location attributes | no | sync structured values; keep editing out of UI until supported options are loaded |
| Services | yes | conditional | Business Information v1 `serviceItems` and category service types | no | persist structured values; editor must not offer invented options |
| Reviews | yes | reply/delete own reply | My Business v4 `GET .../reviews`, `PUT/DELETE .../reviews/{id}/reply` | yes | retain explicit approval; read-after-publish sync |
| Media | yes | create/delete supported media | My Business v4 `.../media` | local gallery only | list and URL upload for `ADDITIONAL`, `COVER`, `PROFILE`; re-list after upload |
| Local Posts | yes | yes (subject to account/location restrictions) | My Business v4 local posts | no | out of MVP: profile/reviews/photos have higher value |
| Questions & Answers | no supported GBP management endpoint | no | none in current GBP management APIs | no | do not implement |

## Safety invariants

* Browser code never receives Google tokens; every Google operation runs in
  the existing `google-business` Edge Function.
* Google is the source of truth. A write is followed by a GET/list and only the
  confirmed response is persisted.
* Location patches are allowlisted and their `updateMask` is derived from the
  supplied fields. Full Location objects are never written back.
* Google validation failures remain HTTP 400 (`google_validation`), 401 marks
  the connection `needs_reauth`, 403 is distinguished from throttling, and only
  429/5xx/network failures use bounded retries.
* AI reply drafts remain drafts until the user explicitly approves them.

## Controlled WERKRUF test-profile checklist

1. Connect using only `business.manage`; finish consent, callback, account and
   location confirmation.
2. Force location sync and compare every persisted field with the Google UI.
3. Change one harmless field; verify the minimal `updateMask`, successful GET,
   and confirmed local value. Restore it through the same flow.
4. Submit an intentionally invalid phone number and verify an actionable 400
   without retry or local mutation.
5. Revoke access, run sync, verify `needs_reauth`, then reconnect and verify the
   refresh-token lifecycle without token values in logs.
6. Check `getGoogleUpdated`; if a diff exists, verify both values and the mask
   are visible/persisted and nothing is accepted automatically.
7. Sync reviews, generate and edit a Claude draft, ensure it is not published,
   explicitly approve it, then verify the re-read reply. Confirm before testing
   deleteReply and verify the subsequent sync.
8. Upload a non-generated test image as `ADDITIONAL` from its HTTPS Cloudinary
   URL; verify it appears after the media re-list. Remove it in Google afterward.
9. Test a second managed account/location and confirm tenant/location isolation.
10. Inspect sync jobs for bounded 429/5xx retry behavior and no duplicate write.
