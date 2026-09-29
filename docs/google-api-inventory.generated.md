# Google-Business-Profile-APIs — Bestandsaufnahme

> Erzeugt von `scripts/google-api-inventory.mjs`. **Nicht von Hand bearbeiten.**
> Die kuratierte Fassung liegt in `docs/google-api-inventory.md`.
> Stand: 2026-09-29T11:06:54.417Z

**7 von 8 Quellen geprüft.**

> **Ungeprüft:** `mybusiness-v4` (HTTP 404)
>
> Ein Abrufversagen sagt NICHTS darüber aus, ob die API im
> Google-Cloud-Projekt aktiviert ist. Discovery-Dokumente sind
> öffentlich und unabhängig von der Projektfreigabe. Ein HTTP 403
> kann auch von einem Egress-Proxy der ausführenden Umgebung
> stammen.

## Überblick


| API | Spezifikation abrufbar | Revision | Methoden | davon schreibend | in WERKRUF | Felder |
|---|---|---|---|---|---|---|
| My Business Business Information API | ja | 20260928 | 15 | 5 | 13 | 155 |
| My Business Account Management API | ja | 20260928 | 16 | 11 | 15 | 43 |
| Google My Business API v4 (Bewertungen, Medien, Beitraege) | **UNGEPRÜFT** (HTTP 404) | — | — | — | — | — |
| My Business Place Actions API | ja | 20260928 | 6 | 3 | 6 | 14 |
| My Business Notifications API | ja | 20260928 | 2 | 1 | 0 | 3 |
| Business Profile Performance API | ja | 20260928 | 3 | 0 | 1 | 24 |
| My Business Verifications API | ja | 20260928 | 6 | 4 | 3 | 56 |
| My Business Lodging API | ja | 20260928 | 3 | 1 | 1 | 591 |

## My Business Business Information API

Discovery: https://mybusinessbusinessinformation.googleapis.com/$discovery/rest?version=v1
Dokumentation: https://developers.google.com/my-business/reference/businessinformation/rest
Revision: `20260928` · Prüfsumme: `1695ead2c901dbd7…`

### Methoden

| Methode | HTTP | Pfad | schreibend | veraltet | in WERKRUF |
|---|---|---|---|---|---|
| `accounts.locations.create` | POST | `v1/{+parent}/locations` | ja | — | ja |
| `accounts.locations.list` | GET | `v1/{+parent}/locations` | — | — | ja |
| `attributes.list` | GET | `v1/attributes` | — | — | ja |
| `categories.batchGet` | GET | `v1/categories:batchGet` | — | — | — |
| `categories.list` | GET | `v1/categories` | — | — | ja |
| `chains.get` | GET | `v1/{+name}` | — | — | ja |
| `chains.search` | GET | `v1/chains:search` | — | — | ja |
| `googleLocations.search` | POST | `v1/googleLocations:search` | ja | — | ja |
| `locations.attributes.getGoogleUpdated` | GET | `v1/{+name}:getGoogleUpdated` | — | — | ja |
| `locations.delete` | DELETE | `v1/{+name}` | ja | — | ja |
| `locations.get` | GET | `v1/{+name}` | — | — | ja |
| `locations.getAttributes` | GET | `v1/{+name}` | — | — | ja |
| `locations.getGoogleUpdated` | GET | `v1/{+name}:getGoogleUpdated` | — | — | ja |
| `locations.patch` | PATCH | `v1/{+name}` | ja | — | ja |
| `locations.updateAttributes` | PATCH | `v1/{+name}` | ja | — | — |

### Felder — 129 schreibbar, 26 nur lesbar, 1 veraltet

| Schema | Feld | Typ | schreibbar | veraltet | Enum-Werte |
|---|---|---|---|---|---|
| AdWordsLocationExtensions | `adPhone` | string | ja | — | — |
| Attribute | `name` | string | ja | — | — |
| Attribute | `repeatedEnumValue` | RepeatedEnumAttributeValue | ja | — | — |
| Attribute | `uriValues` | UriAttributeValue[] | ja | — | — |
| Attribute | `values` | array | ja | — | — |
| Attribute | `valueType` | string | — | — | 5 |
| AttributeMetadata | `deprecated` | boolean | ja | — | — |
| AttributeMetadata | `displayName` | string | ja | — | — |
| AttributeMetadata | `groupDisplayName` | string | ja | — | — |
| AttributeMetadata | `parent` | string | ja | — | — |
| AttributeMetadata | `repeatable` | boolean | ja | — | — |
| AttributeMetadata | `valueMetadata` | AttributeValueMetadata[] | ja | — | — |
| AttributeMetadata | `valueType` | string | ja | — | 5 |
| Attributes | `attributes` | Attribute[] | ja | — | — |
| Attributes | `name` | string | ja | — | — |
| AttributeValueMetadata | `displayName` | string | ja | — | — |
| AttributeValueMetadata | `value` | any | ja | — | — |
| BatchGetCategoriesResponse | `categories` | Category[] | ja | — | — |
| BusinessHours | `periods` | TimePeriod[] | ja | — | — |
| Categories | `additionalCategories` | Category[] | ja | — | — |
| Categories | `primaryCategory` | Category | ja | — | — |
| Category | `displayName` | string | — | — | — |
| Category | `moreHoursTypes` | MoreHoursType[] | — | — | — |
| Category | `name` | string | ja | — | — |
| Category | `serviceTypes` | ServiceType[] | — | — | — |
| Chain | `chainNames` | ChainName[] | ja | — | — |
| Chain | `locationCount` | integer | ja | — | — |
| Chain | `name` | string | ja | — | — |
| Chain | `websites` | ChainUri[] | ja | — | — |
| ChainName | `displayName` | string | ja | — | — |
| ChainName | `languageCode` | string | ja | — | — |
| ChainUri | `uri` | string | ja | — | — |
| Date | `day` | integer | ja | — | — |
| Date | `month` | integer | ja | — | — |
| Date | `year` | integer | ja | — | — |
| FreeFormServiceItem | `category` | string | ja | — | — |
| FreeFormServiceItem | `label` | Label | ja | — | — |
| GoogleLocation | `location` | Location | ja | — | — |
| GoogleLocation | `name` | string | ja | — | — |
| GoogleLocation | `requestAdminRightsUri` | string | ja | — | — |
| GoogleUpdatedLocation | `diffMask` | string | ja | — | — |
| GoogleUpdatedLocation | `location` | Location | ja | — | — |
| GoogleUpdatedLocation | `pendingMask` | string | ja | — | — |
| Label | `description` | string | ja | — | — |
| Label | `displayName` | string | ja | — | — |
| Label | `languageCode` | string | ja | — | — |
| LatLng | `latitude` | number | ja | — | — |
| LatLng | `longitude` | number | ja | — | — |
| ListAttributeMetadataResponse | `attributeMetadata` | AttributeMetadata[] | ja | — | — |
| ListAttributeMetadataResponse | `nextPageToken` | string | ja | — | — |
| ListCategoriesResponse | `categories` | Category[] | ja | — | — |
| ListCategoriesResponse | `nextPageToken` | string | ja | — | — |
| ListLocationsResponse | `locations` | Location[] | ja | — | — |
| ListLocationsResponse | `nextPageToken` | string | ja | — | — |
| ListLocationsResponse | `totalSize` | integer | ja | — | — |
| Location | `adWordsLocationExtensions` | AdWordsLocationExtensions | ja | — | — |
| Location | `categories` | Categories | ja | — | — |
| Location | `labels` | array | ja | — | — |
| Location | `languageCode` | string | ja | — | — |
| Location | `latlng` | LatLng | ja | — | — |
| Location | `metadata` | Metadata | — | — | — |
| Location | `moreHours` | MoreHours[] | ja | — | — |
| Location | `name` | string | ja | — | — |
| Location | `openInfo` | OpenInfo | ja | — | — |
| Location | `phoneNumbers` | PhoneNumbers | ja | — | — |
| Location | `profile` | Profile | ja | — | — |
| Location | `regularHours` | BusinessHours | ja | — | — |
| Location | `relationshipData` | RelationshipData | ja | — | — |
| Location | `serviceArea` | ServiceAreaBusiness | ja | — | — |
| Location | `serviceItems` | ServiceItem[] | ja | — | — |
| Location | `specialHours` | SpecialHours | ja | — | — |
| Location | `storeCode` | string | ja | — | — |
| Location | `storefrontAddress` | PostalAddress | ja | — | — |
| Location | `title` | string | ja | — | — |
| Location | `websiteUri` | string | ja | — | — |
| Metadata | `canDelete` | boolean | — | — | — |
| Metadata | `canHaveBusinessCalls` | boolean | — | — | — |
| Metadata | `canHaveFoodMenus` | boolean | — | — | — |
| Metadata | `canModifyServiceList` | boolean | — | — | — |
| Metadata | `canOperateHealthData` | boolean | — | — | — |
| Metadata | `canOperateLocalPost` | boolean | — | **ja** | — |
| Metadata | `canOperateLodgingData` | boolean | — | — | — |
| Metadata | `duplicateLocation` | string | — | — | — |
| Metadata | `hasGoogleUpdated` | boolean | — | — | — |
| Metadata | `hasPendingEdits` | boolean | — | — | — |
| Metadata | `hasVoiceOfMerchant` | boolean | — | — | — |
| Metadata | `isParticularlyPersonalPlace` | boolean | — | — | — |
| Metadata | `mapsUri` | string | — | — | — |
| Metadata | `newReviewUri` | string | — | — | — |
| Metadata | `placeId` | string | — | — | — |
| Money | `currencyCode` | string | ja | — | — |
| Money | `nanos` | integer | ja | — | — |
| Money | `units` | string | ja | — | — |
| MoreHours | `hoursTypeId` | string | ja | — | — |
| MoreHours | `periods` | TimePeriod[] | ja | — | — |
| MoreHoursType | `displayName` | string | — | — | — |
| MoreHoursType | `hoursTypeId` | string | — | — | — |
| MoreHoursType | `localizedDisplayName` | string | — | — | — |
| OpenInfo | `canReopen` | boolean | — | — | — |
| OpenInfo | `openingDate` | Date | ja | — | — |
| OpenInfo | `status` | string | ja | — | 4 |
| PhoneNumbers | `additionalPhones` | array | ja | — | — |
| PhoneNumbers | `primaryPhone` | string | ja | — | — |
| PlaceInfo | `placeId` | string | ja | — | — |
| PlaceInfo | `placeName` | string | ja | — | — |
| Places | `placeInfos` | PlaceInfo[] | ja | — | — |
| PostalAddress | `addressLines` | array | ja | — | — |
| PostalAddress | `administrativeArea` | string | ja | — | — |
| PostalAddress | `languageCode` | string | ja | — | — |
| PostalAddress | `locality` | string | ja | — | — |
| PostalAddress | `organization` | string | ja | — | — |
| PostalAddress | `postalCode` | string | ja | — | — |
| PostalAddress | `recipients` | array | ja | — | — |
| PostalAddress | `regionCode` | string | ja | — | — |
| PostalAddress | `revision` | integer | ja | — | — |
| PostalAddress | `sortingCode` | string | ja | — | — |
| PostalAddress | `sublocality` | string | ja | — | — |
| Profile | `description` | string | ja | — | — |
| RelationshipData | `childrenLocations` | RelevantLocation[] | ja | — | — |
| RelationshipData | `parentChain` | string | ja | — | — |
| RelationshipData | `parentLocation` | RelevantLocation | ja | — | — |
| RelevantLocation | `placeId` | string | ja | — | — |
| RelevantLocation | `relationType` | string | ja | — | 3 |
| RepeatedEnumAttributeValue | `setValues` | array | ja | — | — |
| RepeatedEnumAttributeValue | `unsetValues` | array | ja | — | — |
| SearchChainsResponse | `chains` | Chain[] | ja | — | — |
| SearchGoogleLocationsRequest | `location` | Location | ja | — | — |
| SearchGoogleLocationsRequest | `pageSize` | integer | ja | — | — |
| SearchGoogleLocationsRequest | `query` | string | ja | — | — |
| SearchGoogleLocationsResponse | `googleLocations` | GoogleLocation[] | ja | — | — |
| ServiceAreaBusiness | `businessType` | string | ja | — | 3 |
| ServiceAreaBusiness | `places` | Places | ja | — | — |
| ServiceAreaBusiness | `regionCode` | string | ja | — | — |
| ServiceItem | `freeFormServiceItem` | FreeFormServiceItem | ja | — | — |
| ServiceItem | `price` | Money | ja | — | — |
| ServiceItem | `structuredServiceItem` | StructuredServiceItem | ja | — | — |
| ServiceType | `displayName` | string | — | — | — |
| ServiceType | `serviceTypeId` | string | — | — | — |
| SpecialHourPeriod | `closed` | boolean | ja | — | — |
| SpecialHourPeriod | `closeTime` | TimeOfDay | ja | — | — |
| SpecialHourPeriod | `endDate` | Date | ja | — | — |
| SpecialHourPeriod | `openTime` | TimeOfDay | ja | — | — |
| SpecialHourPeriod | `startDate` | Date | ja | — | — |
| SpecialHours | `specialHourPeriods` | SpecialHourPeriod[] | ja | — | — |
| StructuredServiceItem | `description` | string | ja | — | — |
| StructuredServiceItem | `serviceTypeId` | string | ja | — | — |
| TimeOfDay | `hours` | integer | ja | — | — |
| TimeOfDay | `minutes` | integer | ja | — | — |
| TimeOfDay | `nanos` | integer | ja | — | — |
| TimeOfDay | `seconds` | integer | ja | — | — |
| TimePeriod | `closeDay` | string | ja | — | 8 |
| TimePeriod | `closeTime` | TimeOfDay | ja | — | — |
| TimePeriod | `openDay` | string | ja | — | 8 |
| TimePeriod | `openTime` | TimeOfDay | ja | — | — |
| UriAttributeValue | `uri` | string | ja | — | — |

## My Business Account Management API

Discovery: https://mybusinessaccountmanagement.googleapis.com/$discovery/rest?version=v1
Dokumentation: https://developers.google.com/my-business/reference/accountmanagement/rest
Revision: `20260928` · Prüfsumme: `99eadeae4cb26c73…`

### Methoden

| Methode | HTTP | Pfad | schreibend | veraltet | in WERKRUF |
|---|---|---|---|---|---|
| `accounts.admins.create` | POST | `v1/{+parent}/admins` | ja | — | ja |
| `accounts.admins.delete` | DELETE | `v1/{+name}` | ja | — | ja |
| `accounts.admins.list` | GET | `v1/{+parent}/admins` | — | — | ja |
| `accounts.admins.patch` | PATCH | `v1/{+name}` | ja | — | ja |
| `accounts.create` | POST | `v1/accounts` | ja | — | ja |
| `accounts.get` | GET | `v1/{+name}` | — | — | ja |
| `accounts.invitations.accept` | POST | `v1/{+name}:accept` | ja | — | ja |
| `accounts.invitations.decline` | POST | `v1/{+name}:decline` | ja | — | ja |
| `accounts.invitations.list` | GET | `v1/{+parent}/invitations` | — | — | ja |
| `accounts.list` | GET | `v1/accounts` | — | — | ja |
| `accounts.patch` | PATCH | `v1/{+name}` | ja | — | ja |
| `locations.admins.create` | POST | `v1/{+parent}/admins` | ja | — | ja |
| `locations.admins.delete` | DELETE | `v1/{+name}` | ja | — | ja |
| `locations.admins.list` | GET | `v1/{+parent}/admins` | — | — | ja |
| `locations.admins.patch` | PATCH | `v1/{+name}` | ja | — | ja |
| `locations.transfer` | POST | `v1/{+name}:transfer` | ja | — | — |

### Felder — 30 schreibbar, 13 nur lesbar, 0 veraltet

| Schema | Feld | Typ | schreibbar | veraltet | Enum-Werte |
|---|---|---|---|---|---|
| Account | `accountName` | string | ja | — | — |
| Account | `accountNumber` | string | — | — | — |
| Account | `name` | string | ja | — | — |
| Account | `organizationInfo` | OrganizationInfo | — | — | — |
| Account | `permissionLevel` | string | — | — | 3 |
| Account | `primaryOwner` | string | ja | — | — |
| Account | `role` | string | — | — | 5 |
| Account | `type` | string | ja | — | 5 |
| Account | `verificationState` | string | — | — | 4 |
| Account | `vettedState` | string | — | — | 4 |
| Admin | `account` | string | ja | — | — |
| Admin | `admin` | string | ja | — | — |
| Admin | `name` | string | ja | — | — |
| Admin | `pendingInvitation` | boolean | — | — | — |
| Admin | `role` | string | ja | — | 5 |
| Invitation | `name` | string | ja | — | — |
| Invitation | `role` | string | — | — | 5 |
| Invitation | `targetAccount` | Account | ja | — | — |
| Invitation | `targetLocation` | TargetLocation | ja | — | — |
| Invitation | `targetType` | string | — | — | 3 |
| ListAccountAdminsResponse | `accountAdmins` | Admin[] | ja | — | — |
| ListAccountsResponse | `accounts` | Account[] | ja | — | — |
| ListAccountsResponse | `nextPageToken` | string | ja | — | — |
| ListInvitationsResponse | `invitations` | Invitation[] | ja | — | — |
| ListLocationAdminsResponse | `admins` | Admin[] | ja | — | — |
| OrganizationInfo | `address` | PostalAddress | — | — | — |
| OrganizationInfo | `phoneNumber` | string | — | — | — |
| OrganizationInfo | `registeredDomain` | string | — | — | — |
| PostalAddress | `addressLines` | array | ja | — | — |
| PostalAddress | `administrativeArea` | string | ja | — | — |
| PostalAddress | `languageCode` | string | ja | — | — |
| PostalAddress | `locality` | string | ja | — | — |
| PostalAddress | `organization` | string | ja | — | — |
| PostalAddress | `postalCode` | string | ja | — | — |
| PostalAddress | `recipients` | array | ja | — | — |
| PostalAddress | `regionCode` | string | ja | — | — |
| PostalAddress | `revision` | integer | ja | — | — |
| PostalAddress | `sortingCode` | string | ja | — | — |
| PostalAddress | `sublocality` | string | ja | — | — |
| TargetLocation | `address` | string | ja | — | — |
| TargetLocation | `locationName` | string | ja | — | — |
| TargetLocation | `placeId` | string | — | — | — |
| TransferLocationRequest | `destinationAccount` | string | ja | — | — |

## My Business Place Actions API

Discovery: https://mybusinessplaceactions.googleapis.com/$discovery/rest?version=v1
Dokumentation: https://developers.google.com/my-business/reference/placeactions/rest
Revision: `20260928` · Prüfsumme: `d15f92a562cefb01…`

### Methoden

| Methode | HTTP | Pfad | schreibend | veraltet | in WERKRUF |
|---|---|---|---|---|---|
| `locations.placeActionLinks.create` | POST | `v1/{+parent}/placeActionLinks` | ja | — | ja |
| `locations.placeActionLinks.delete` | DELETE | `v1/{+name}` | ja | — | ja |
| `locations.placeActionLinks.get` | GET | `v1/{+name}` | — | — | ja |
| `locations.placeActionLinks.list` | GET | `v1/{+parent}/placeActionLinks` | — | — | ja |
| `locations.placeActionLinks.patch` | PATCH | `v1/{+name}` | ja | — | ja |
| `placeActionTypeMetadata.list` | GET | `v1/placeActionTypeMetadata` | — | — | ja |

### Felder — 10 schreibbar, 4 nur lesbar, 0 veraltet

| Schema | Feld | Typ | schreibbar | veraltet | Enum-Werte |
|---|---|---|---|---|---|
| ListPlaceActionLinksResponse | `nextPageToken` | string | ja | — | — |
| ListPlaceActionLinksResponse | `placeActionLinks` | PlaceActionLink[] | ja | — | — |
| ListPlaceActionTypeMetadataResponse | `nextPageToken` | string | ja | — | — |
| ListPlaceActionTypeMetadataResponse | `placeActionTypeMetadata` | PlaceActionTypeMetadata[] | ja | — | — |
| PlaceActionLink | `createTime` | string | — | — | — |
| PlaceActionLink | `isEditable` | boolean | — | — | — |
| PlaceActionLink | `isPreferred` | boolean | ja | — | — |
| PlaceActionLink | `name` | string | ja | — | — |
| PlaceActionLink | `placeActionType` | string | ja | — | 9 |
| PlaceActionLink | `providerType` | string | — | — | 3 |
| PlaceActionLink | `updateTime` | string | — | — | — |
| PlaceActionLink | `uri` | string | ja | — | — |
| PlaceActionTypeMetadata | `displayName` | string | ja | — | — |
| PlaceActionTypeMetadata | `placeActionType` | string | ja | — | 9 |

## My Business Notifications API

Discovery: https://mybusinessnotifications.googleapis.com/$discovery/rest?version=v1
Dokumentation: https://developers.google.com/my-business/reference/notifications/rest
Revision: `20260928` · Prüfsumme: `8e1f0008ae6e96fa…`

### Methoden

| Methode | HTTP | Pfad | schreibend | veraltet | in WERKRUF |
|---|---|---|---|---|---|
| `accounts.getNotificationSetting` | GET | `v1/{+name}` | — | — | — |
| `accounts.updateNotificationSetting` | PATCH | `v1/{+name}` | ja | — | — |

### Felder — 3 schreibbar, 0 nur lesbar, 0 veraltet

| Schema | Feld | Typ | schreibbar | veraltet | Enum-Werte |
|---|---|---|---|---|---|
| NotificationSetting | `name` | string | ja | — | — |
| NotificationSetting | `notificationTypes` | array | ja | — | — |
| NotificationSetting | `pubsubTopic` | string | ja | — | — |

## Business Profile Performance API

Discovery: https://businessprofileperformance.googleapis.com/$discovery/rest?version=v1
Dokumentation: https://developers.google.com/my-business/reference/performance/rest
Revision: `20260928` · Prüfsumme: `a3d81f89824f1572…`

### Methoden

| Methode | HTTP | Pfad | schreibend | veraltet | in WERKRUF |
|---|---|---|---|---|---|
| `locations.fetchMultiDailyMetricsTimeSeries` | GET | `v1/{+location}:fetchMultiDailyMetricsTimeSeries` | — | — | — |
| `locations.getDailyMetricsTimeSeries` | GET | `v1/{+name}:getDailyMetricsTimeSeries` | — | — | — |
| `locations.searchkeywords.impressions.monthly.list` | GET | `v1/{+parent}/searchkeywords/impressions/monthly` | — | — | ja |

### Felder — 24 schreibbar, 0 nur lesbar, 0 veraltet

| Schema | Feld | Typ | schreibbar | veraltet | Enum-Werte |
|---|---|---|---|---|---|
| DailyMetricTimeSeries | `dailyMetric` | string | ja | — | 12 |
| DailyMetricTimeSeries | `dailySubEntityType` | DailySubEntityType | ja | — | — |
| DailyMetricTimeSeries | `timeSeries` | TimeSeries | ja | — | — |
| DailySubEntityType | `dayOfWeek` | string | ja | — | 8 |
| DailySubEntityType | `timeOfDay` | TimeOfDay | ja | — | — |
| Date | `day` | integer | ja | — | — |
| Date | `month` | integer | ja | — | — |
| Date | `year` | integer | ja | — | — |
| DatedValue | `date` | Date | ja | — | — |
| DatedValue | `value` | string | ja | — | — |
| FetchMultiDailyMetricsTimeSeriesResponse | `multiDailyMetricTimeSeries` | MultiDailyMetricTimeSeries[] | ja | — | — |
| GetDailyMetricsTimeSeriesResponse | `timeSeries` | TimeSeries | ja | — | — |
| InsightsValue | `threshold` | string | ja | — | — |
| InsightsValue | `value` | string | ja | — | — |
| ListSearchKeywordImpressionsMonthlyResponse | `nextPageToken` | string | ja | — | — |
| ListSearchKeywordImpressionsMonthlyResponse | `searchKeywordsCounts` | SearchKeywordCount[] | ja | — | — |
| MultiDailyMetricTimeSeries | `dailyMetricTimeSeries` | DailyMetricTimeSeries[] | ja | — | — |
| SearchKeywordCount | `insightsValue` | InsightsValue | ja | — | — |
| SearchKeywordCount | `searchKeyword` | string | ja | — | — |
| TimeOfDay | `hours` | integer | ja | — | — |
| TimeOfDay | `minutes` | integer | ja | — | — |
| TimeOfDay | `nanos` | integer | ja | — | — |
| TimeOfDay | `seconds` | integer | ja | — | — |
| TimeSeries | `datedValues` | DatedValue[] | ja | — | — |

## My Business Verifications API

Discovery: https://mybusinessverifications.googleapis.com/$discovery/rest?version=v1
Dokumentation: https://developers.google.com/my-business/reference/verifications/rest
Revision: `20260928` · Prüfsumme: `e998fee017279095…`

### Methoden

| Methode | HTTP | Pfad | schreibend | veraltet | in WERKRUF |
|---|---|---|---|---|---|
| `locations.fetchVerificationOptions` | POST | `v1/{+location}:fetchVerificationOptions` | ja | — | — |
| `locations.getVoiceOfMerchantState` | GET | `v1/{+name}/VoiceOfMerchantState` | — | — | — |
| `locations.verifications.complete` | POST | `v1/{+name}:complete` | ja | — | ja |
| `locations.verifications.list` | GET | `v1/{+parent}/verifications` | — | — | ja |
| `locations.verify` | POST | `v1/{+name}:verify` | ja | — | — |
| `verificationTokens.generate` | POST | `v1/verificationTokens:generate` | ja | — | ja |

### Felder — 55 schreibbar, 1 nur lesbar, 0 veraltet

| Schema | Feld | Typ | schreibbar | veraltet | Enum-Werte |
|---|---|---|---|---|---|
| AddressVerificationData | `address` | PostalAddress | ja | — | — |
| AddressVerificationData | `business` | string | ja | — | — |
| AddressVerificationData | `expectedDeliveryDaysRegion` | integer | ja | — | — |
| CompleteVerificationRequest | `pin` | string | ja | — | — |
| CompleteVerificationResponse | `verification` | Verification | ja | — | — |
| ComplyWithGuidelines | `recommendationReason` | string | ja | — | 3 |
| EmailVerificationData | `domain` | string | ja | — | — |
| EmailVerificationData | `isUserNameEditable` | boolean | ja | — | — |
| EmailVerificationData | `user` | string | ja | — | — |
| FetchVerificationOptionsRequest | `context` | ServiceBusinessContext | ja | — | — |
| FetchVerificationOptionsRequest | `languageCode` | string | ja | — | — |
| FetchVerificationOptionsResponse | `options` | VerificationOption[] | ja | — | — |
| GenerateInstantVerificationTokenRequest | `locationId` | string | ja | — | — |
| GenerateInstantVerificationTokenResponse | `instantVerificationToken` | string | ja | — | — |
| GenerateInstantVerificationTokenResponse | `result` | string | — | — | 3 |
| ListVerificationsResponse | `nextPageToken` | string | ja | — | — |
| ListVerificationsResponse | `verifications` | Verification[] | ja | — | — |
| PostalAddress | `addressLines` | array | ja | — | — |
| PostalAddress | `administrativeArea` | string | ja | — | — |
| PostalAddress | `languageCode` | string | ja | — | — |
| PostalAddress | `locality` | string | ja | — | — |
| PostalAddress | `organization` | string | ja | — | — |
| PostalAddress | `postalCode` | string | ja | — | — |
| PostalAddress | `recipients` | array | ja | — | — |
| PostalAddress | `regionCode` | string | ja | — | — |
| PostalAddress | `revision` | integer | ja | — | — |
| PostalAddress | `sortingCode` | string | ja | — | — |
| PostalAddress | `sublocality` | string | ja | — | — |
| ServiceBusinessContext | `address` | PostalAddress | ja | — | — |
| Verification | `announcement` | string | ja | — | — |
| Verification | `createTime` | string | ja | — | — |
| Verification | `method` | string | ja | — | 7 |
| Verification | `name` | string | ja | — | — |
| Verification | `state` | string | ja | — | 4 |
| VerificationOption | `addressData` | AddressVerificationData | ja | — | — |
| VerificationOption | `announcement` | string | ja | — | — |
| VerificationOption | `emailData` | EmailVerificationData | ja | — | — |
| VerificationOption | `phoneNumber` | string | ja | — | — |
| VerificationOption | `verificationMethod` | string | ja | — | 7 |
| VerificationToken | `tokenString` | string | ja | — | — |
| Verify | `hasPendingVerification` | boolean | ja | — | — |
| VerifyLocationRequest | `context` | ServiceBusinessContext | ja | — | — |
| VerifyLocationRequest | `emailAddress` | string | ja | — | — |
| VerifyLocationRequest | `languageCode` | string | ja | — | — |
| VerifyLocationRequest | `mailerContact` | string | ja | — | — |
| VerifyLocationRequest | `method` | string | ja | — | 7 |
| VerifyLocationRequest | `phoneNumber` | string | ja | — | — |
| VerifyLocationRequest | `token` | VerificationToken | ja | — | — |
| VerifyLocationRequest | `trustedPartnerToken` | string | ja | — | — |
| VerifyLocationResponse | `verification` | Verification | ja | — | — |
| VoiceOfMerchantState | `complyWithGuidelines` | ComplyWithGuidelines | ja | — | — |
| VoiceOfMerchantState | `hasBusinessAuthority` | boolean | ja | — | — |
| VoiceOfMerchantState | `hasVoiceOfMerchant` | boolean | ja | — | — |
| VoiceOfMerchantState | `resolveOwnershipConflict` | ResolveOwnershipConflict | ja | — | — |
| VoiceOfMerchantState | `verify` | Verify | ja | — | — |
| VoiceOfMerchantState | `waitForVoiceOfMerchant` | WaitForVoiceOfMerchant | ja | — | — |

## My Business Lodging API

Discovery: https://mybusinesslodging.googleapis.com/$discovery/rest?version=v1
Dokumentation: https://developers.google.com/my-business/reference/lodging/rest
Revision: `20260928` · Prüfsumme: `42729d1d2d3b7df9…`

### Methoden

| Methode | HTTP | Pfad | schreibend | veraltet | in WERKRUF |
|---|---|---|---|---|---|
| `locations.getLodging` | GET | `v1/{+name}` | — | — | — |
| `locations.lodging.getGoogleUpdated` | GET | `v1/{+name}:getGoogleUpdated` | — | — | ja |
| `locations.updateLodging` | PATCH | `v1/{+name}` | ja | — | — |

### Felder — 587 schreibbar, 4 nur lesbar, 1 veraltet

| Schema | Feld | Typ | schreibbar | veraltet | Enum-Werte |
|---|---|---|---|---|---|
| Accessibility | `mobilityAccessible` | boolean | ja | — | — |
| Accessibility | `mobilityAccessibleElevator` | boolean | ja | — | — |
| Accessibility | `mobilityAccessibleElevatorException` | string | ja | — | 4 |
| Accessibility | `mobilityAccessibleException` | string | ja | — | 4 |
| Accessibility | `mobilityAccessibleParking` | boolean | ja | — | — |
| Accessibility | `mobilityAccessibleParkingException` | string | ja | — | 4 |
| Accessibility | `mobilityAccessiblePool` | boolean | ja | — | — |
| Accessibility | `mobilityAccessiblePoolException` | string | ja | — | 4 |
| Activities | `beachAccess` | boolean | ja | — | — |
| Activities | `beachAccessException` | string | ja | — | 4 |
| Activities | `beachFront` | boolean | ja | — | — |
| Activities | `beachFrontException` | string | ja | — | 4 |
| Activities | `bicycleRental` | boolean | ja | — | — |
| Activities | `bicycleRentalException` | string | ja | — | 4 |
| Activities | `boutiqueStores` | boolean | ja | — | — |
| Activities | `boutiqueStoresException` | string | ja | — | 4 |
| Activities | `casino` | boolean | ja | — | — |
| Activities | `casinoException` | string | ja | — | 4 |
| Activities | `freeBicycleRental` | boolean | ja | — | — |
| Activities | `freeBicycleRentalException` | string | ja | — | 4 |
| Activities | `freeWatercraftRental` | boolean | ja | — | — |
| Activities | `freeWatercraftRentalException` | string | ja | — | 4 |
| Activities | `gameRoom` | boolean | ja | — | — |
| Activities | `gameRoomException` | string | ja | — | 4 |
| Activities | `golf` | boolean | ja | — | — |
| Activities | `golfException` | string | ja | — | 4 |
| Activities | `horsebackRiding` | boolean | ja | — | — |
| Activities | `horsebackRidingException` | string | ja | — | 4 |
| Activities | `nightclub` | boolean | ja | — | — |
| Activities | `nightclubException` | string | ja | — | 4 |
| Activities | `privateBeach` | boolean | ja | — | — |
| Activities | `privateBeachException` | string | ja | — | 4 |
| Activities | `scuba` | boolean | ja | — | — |
| Activities | `scubaException` | string | ja | — | 4 |
| Activities | `snorkeling` | boolean | ja | — | — |
| Activities | `snorkelingException` | string | ja | — | 4 |
| Activities | `tennis` | boolean | ja | — | — |
| Activities | `tennisException` | string | ja | — | 4 |
| Activities | `watercraftRental` | boolean | ja | — | — |
| Activities | `watercraftRentalException` | string | ja | — | 4 |
| Activities | `waterSkiing` | boolean | ja | — | — |
| Activities | `waterSkiingException` | string | ja | — | 4 |
| Business | `businessCenter` | boolean | ja | — | — |
| Business | `businessCenterException` | string | ja | — | 4 |
| Business | `meetingRooms` | boolean | ja | — | — |
| Business | `meetingRoomsCount` | integer | ja | — | — |
| Business | `meetingRoomsCountException` | string | ja | — | 4 |
| Business | `meetingRoomsException` | string | ja | — | 4 |
| Connectivity | `freeWifi` | boolean | ja | — | — |
| Connectivity | `freeWifiException` | string | ja | — | 4 |
| Connectivity | `publicAreaWifiAvailable` | boolean | ja | — | — |
| Connectivity | `publicAreaWifiAvailableException` | string | ja | — | 4 |
| Connectivity | `publicInternetTerminal` | boolean | ja | — | — |
| Connectivity | `publicInternetTerminalException` | string | ja | — | 4 |
| Connectivity | `wifiAvailable` | boolean | ja | — | — |
| Connectivity | `wifiAvailableException` | string | ja | — | 4 |
| EcoCertification | `awarded` | boolean | ja | — | — |
| EcoCertification | `awardedException` | string | ja | — | 4 |
| EcoCertification | `ecoCertificate` | string | ja | — | 28 |
| EnergyEfficiency | `carbonFreeEnergySources` | boolean | ja | — | — |
| EnergyEfficiency | `carbonFreeEnergySourcesException` | string | ja | — | 4 |
| EnergyEfficiency | `energyConservationProgram` | boolean | ja | — | — |
| EnergyEfficiency | `energyConservationProgramException` | string | ja | — | 4 |
| EnergyEfficiency | `energyEfficientHeatingAndCoolingSystems` | boolean | ja | — | — |
| EnergyEfficiency | `energyEfficientHeatingAndCoolingSystemsException` | string | ja | — | 4 |
| EnergyEfficiency | `energyEfficientLighting` | boolean | ja | — | — |
| EnergyEfficiency | `energyEfficientLightingException` | string | ja | — | 4 |
| EnergyEfficiency | `energySavingThermostats` | boolean | ja | — | — |
| EnergyEfficiency | `energySavingThermostatsException` | string | ja | — | 4 |
| EnergyEfficiency | `greenBuildingDesign` | boolean | — | — | — |
| EnergyEfficiency | `greenBuildingDesignException` | string | — | — | 4 |
| EnergyEfficiency | `independentOrganizationAuditsEnergyUse` | boolean | ja | — | — |
| EnergyEfficiency | `independentOrganizationAuditsEnergyUseException` | string | ja | — | 4 |
| EnhancedCleaning | `commercialGradeDisinfectantCleaning` | boolean | ja | — | — |
| EnhancedCleaning | `commercialGradeDisinfectantCleaningException` | string | ja | — | 4 |
| EnhancedCleaning | `commonAreasEnhancedCleaning` | boolean | ja | — | — |
| EnhancedCleaning | `commonAreasEnhancedCleaningException` | string | ja | — | 4 |
| EnhancedCleaning | `employeesTrainedCleaningProcedures` | boolean | ja | — | — |
| EnhancedCleaning | `employeesTrainedCleaningProceduresException` | string | ja | — | 4 |
| EnhancedCleaning | `employeesTrainedThoroughHandWashing` | boolean | ja | — | — |
| EnhancedCleaning | `employeesTrainedThoroughHandWashingException` | string | ja | — | 4 |
| EnhancedCleaning | `employeesWearProtectiveEquipment` | boolean | ja | — | — |
| EnhancedCleaning | `employeesWearProtectiveEquipmentException` | string | ja | — | 4 |
| EnhancedCleaning | `guestRoomsEnhancedCleaning` | boolean | ja | — | — |
| EnhancedCleaning | `guestRoomsEnhancedCleaningException` | string | ja | — | 4 |
| Families | `babysitting` | boolean | ja | — | — |
| Families | `babysittingException` | string | ja | — | 4 |
| Families | `kidsActivities` | boolean | ja | — | — |
| Families | `kidsActivitiesException` | string | ja | — | 4 |
| Families | `kidsClub` | boolean | ja | — | — |
| Families | `kidsClubException` | string | ja | — | 4 |
| Families | `kidsFriendly` | boolean | ja | — | — |
| Families | `kidsFriendlyException` | string | ja | — | 4 |
| FoodAndDrink | `bar` | boolean | ja | — | — |
| FoodAndDrink | `barException` | string | ja | — | 4 |
| FoodAndDrink | `breakfastAvailable` | boolean | ja | — | — |
| FoodAndDrink | `breakfastAvailableException` | string | ja | — | 4 |
| FoodAndDrink | `breakfastBuffet` | boolean | ja | — | — |
| FoodAndDrink | `breakfastBuffetException` | string | ja | — | 4 |
| FoodAndDrink | `buffet` | boolean | ja | — | — |
| FoodAndDrink | `buffetException` | string | ja | — | 4 |
| FoodAndDrink | `dinnerBuffet` | boolean | ja | — | — |
| FoodAndDrink | `dinnerBuffetException` | string | ja | — | 4 |
| FoodAndDrink | `freeBreakfast` | boolean | ja | — | — |
| FoodAndDrink | `freeBreakfastException` | string | ja | — | 4 |
| FoodAndDrink | `restaurant` | boolean | ja | — | — |
| FoodAndDrink | `restaurantException` | string | ja | — | 4 |
| FoodAndDrink | `restaurantsCount` | integer | ja | — | — |
| FoodAndDrink | `restaurantsCountException` | string | ja | — | 4 |
| FoodAndDrink | `roomService` | boolean | ja | — | — |
| FoodAndDrink | `roomServiceException` | string | ja | — | 4 |
| FoodAndDrink | `tableService` | boolean | ja | — | — |
| FoodAndDrink | `tableServiceException` | string | ja | — | 4 |
| FoodAndDrink | `twentyFourHourRoomService` | boolean | ja | — | — |
| FoodAndDrink | `twentyFourHourRoomServiceException` | string | ja | — | 4 |
| FoodAndDrink | `vendingMachine` | boolean | ja | — | — |
| FoodAndDrink | `vendingMachineException` | string | ja | — | 4 |
| GetGoogleUpdatedLodgingResponse | `diffMask` | string | ja | — | — |
| GetGoogleUpdatedLodgingResponse | `lodging` | Lodging | ja | — | — |
| GuestUnitFeatures | `bungalowOrVilla` | boolean | ja | — | — |
| GuestUnitFeatures | `bungalowOrVillaException` | string | ja | — | 4 |
| GuestUnitFeatures | `connectingUnitAvailable` | boolean | ja | — | — |
| GuestUnitFeatures | `connectingUnitAvailableException` | string | ja | — | 4 |
| GuestUnitFeatures | `executiveFloor` | boolean | ja | — | — |
| GuestUnitFeatures | `executiveFloorException` | string | ja | — | 4 |
| GuestUnitFeatures | `maxAdultOccupantsCount` | integer | ja | — | — |
| GuestUnitFeatures | `maxAdultOccupantsCountException` | string | ja | — | 4 |
| GuestUnitFeatures | `maxChildOccupantsCount` | integer | ja | — | — |
| GuestUnitFeatures | `maxChildOccupantsCountException` | string | ja | — | 4 |
| GuestUnitFeatures | `maxOccupantsCount` | integer | ja | — | — |
| GuestUnitFeatures | `maxOccupantsCountException` | string | ja | — | 4 |
| GuestUnitFeatures | `privateHome` | boolean | ja | — | — |
| GuestUnitFeatures | `privateHomeException` | string | ja | — | 4 |
| GuestUnitFeatures | `suite` | boolean | ja | — | — |
| GuestUnitFeatures | `suiteException` | string | ja | — | 4 |
| GuestUnitFeatures | `tier` | string | ja | — | 3 |
| GuestUnitFeatures | `tierException` | string | ja | — | 4 |
| GuestUnitFeatures | `totalLivingAreas` | LivingArea | ja | — | — |
| GuestUnitFeatures | `views` | ViewsFromUnit | ja | — | — |
| GuestUnitType | `codes` | array | ja | — | — |
| GuestUnitType | `features` | GuestUnitFeatures | ja | — | — |
| GuestUnitType | `label` | string | ja | — | — |
| HealthAndSafety | `enhancedCleaning` | EnhancedCleaning | ja | — | — |
| HealthAndSafety | `increasedFoodSafety` | IncreasedFoodSafety | ja | — | — |
| HealthAndSafety | `minimizedContact` | MinimizedContact | ja | — | — |
| HealthAndSafety | `personalProtection` | PersonalProtection | ja | — | — |
| HealthAndSafety | `physicalDistancing` | PhysicalDistancing | ja | — | — |
| Housekeeping | `dailyHousekeeping` | boolean | ja | — | — |
| Housekeeping | `dailyHousekeepingException` | string | ja | — | 4 |
| Housekeeping | `housekeepingAvailable` | boolean | ja | — | — |
| Housekeeping | `housekeepingAvailableException` | string | ja | — | 4 |
| Housekeeping | `turndownService` | boolean | ja | — | — |
| Housekeeping | `turndownServiceException` | string | ja | — | 4 |
| IncreasedFoodSafety | `diningAreasAdditionalSanitation` | boolean | ja | — | — |
| IncreasedFoodSafety | `diningAreasAdditionalSanitationException` | string | ja | — | 4 |
| IncreasedFoodSafety | `disposableFlatware` | boolean | ja | — | — |
| IncreasedFoodSafety | `disposableFlatwareException` | string | ja | — | 4 |
| IncreasedFoodSafety | `foodPreparationAndServingAdditionalSafety` | boolean | ja | — | — |
| IncreasedFoodSafety | `foodPreparationAndServingAdditionalSafetyException` | string | ja | — | 4 |
| IncreasedFoodSafety | `individualPackagedMeals` | boolean | ja | — | — |
| IncreasedFoodSafety | `individualPackagedMealsException` | string | ja | — | 4 |
| IncreasedFoodSafety | `singleUseFoodMenus` | boolean | ja | — | — |
| IncreasedFoodSafety | `singleUseFoodMenusException` | string | ja | — | 4 |
| LanguageSpoken | `languageCode` | string | ja | — | — |
| LanguageSpoken | `spoken` | boolean | ja | — | — |
| LanguageSpoken | `spokenException` | string | ja | — | 4 |
| LivingArea | `accessibility` | LivingAreaAccessibility | ja | — | — |
| LivingArea | `eating` | LivingAreaEating | ja | — | — |
| LivingArea | `features` | LivingAreaFeatures | ja | — | — |
| LivingArea | `layout` | LivingAreaLayout | ja | — | — |
| LivingArea | `sleeping` | LivingAreaSleeping | ja | — | — |
| LivingAreaAccessibility | `adaCompliantUnit` | boolean | ja | — | — |
| LivingAreaAccessibility | `adaCompliantUnitException` | string | ja | — | 4 |
| LivingAreaAccessibility | `hearingAccessibleDoorbell` | boolean | ja | — | — |
| LivingAreaAccessibility | `hearingAccessibleDoorbellException` | string | ja | — | 4 |
| LivingAreaAccessibility | `hearingAccessibleFireAlarm` | boolean | ja | — | — |
| LivingAreaAccessibility | `hearingAccessibleFireAlarmException` | string | ja | — | 4 |
| LivingAreaAccessibility | `hearingAccessibleUnit` | boolean | ja | — | — |
| LivingAreaAccessibility | `hearingAccessibleUnitException` | string | ja | — | 4 |
| LivingAreaAccessibility | `mobilityAccessibleBathtub` | boolean | ja | — | — |
| LivingAreaAccessibility | `mobilityAccessibleBathtubException` | string | ja | — | 4 |
| LivingAreaAccessibility | `mobilityAccessibleShower` | boolean | ja | — | — |
| LivingAreaAccessibility | `mobilityAccessibleShowerException` | string | ja | — | 4 |
| LivingAreaAccessibility | `mobilityAccessibleToilet` | boolean | ja | — | — |
| LivingAreaAccessibility | `mobilityAccessibleToiletException` | string | ja | — | 4 |
| LivingAreaAccessibility | `mobilityAccessibleUnit` | boolean | ja | — | — |
| LivingAreaAccessibility | `mobilityAccessibleUnitException` | string | ja | — | 4 |
| LivingAreaEating | `coffeeMaker` | boolean | ja | — | — |
| LivingAreaEating | `coffeeMakerException` | string | ja | — | 4 |
| LivingAreaEating | `cookware` | boolean | ja | — | — |
| LivingAreaEating | `cookwareException` | string | ja | — | 4 |
| LivingAreaEating | `dishwasher` | boolean | ja | — | — |
| LivingAreaEating | `dishwasherException` | string | ja | — | 4 |
| LivingAreaEating | `indoorGrill` | boolean | ja | — | — |
| LivingAreaEating | `indoorGrillException` | string | ja | — | 4 |
| LivingAreaEating | `kettle` | boolean | ja | — | — |
| LivingAreaEating | `kettleException` | string | ja | — | 4 |
| LivingAreaEating | `kitchenAvailable` | boolean | ja | — | — |
| LivingAreaEating | `kitchenAvailableException` | string | ja | — | 4 |
| LivingAreaEating | `microwave` | boolean | ja | — | — |
| LivingAreaEating | `microwaveException` | string | ja | — | 4 |
| LivingAreaEating | `minibar` | boolean | ja | — | — |
| LivingAreaEating | `minibarException` | string | ja | — | 4 |
| LivingAreaEating | `outdoorGrill` | boolean | ja | — | — |
| LivingAreaEating | `outdoorGrillException` | string | ja | — | 4 |
| LivingAreaEating | `oven` | boolean | ja | — | — |
| LivingAreaEating | `ovenException` | string | ja | — | 4 |
| LivingAreaEating | `refrigerator` | boolean | ja | — | — |
| LivingAreaEating | `refrigeratorException` | string | ja | — | 4 |
| LivingAreaEating | `sink` | boolean | ja | — | — |
| LivingAreaEating | `sinkException` | string | ja | — | 4 |
| LivingAreaEating | `snackbar` | boolean | ja | — | — |
| LivingAreaEating | `snackbarException` | string | ja | — | 4 |
| LivingAreaEating | `stove` | boolean | ja | — | — |
| LivingAreaEating | `stoveException` | string | ja | — | 4 |
| LivingAreaEating | `teaStation` | boolean | ja | — | — |
| LivingAreaEating | `teaStationException` | string | ja | — | 4 |
| LivingAreaEating | `toaster` | boolean | ja | — | — |
| LivingAreaEating | `toasterException` | string | ja | — | 4 |
| LivingAreaFeatures | `airConditioning` | boolean | ja | — | — |
| LivingAreaFeatures | `airConditioningException` | string | ja | — | 4 |
| LivingAreaFeatures | `bathtub` | boolean | ja | — | — |
| LivingAreaFeatures | `bathtubException` | string | ja | — | 4 |
| LivingAreaFeatures | `bidet` | boolean | ja | — | — |
| LivingAreaFeatures | `bidetException` | string | ja | — | 4 |
| LivingAreaFeatures | `dryer` | boolean | ja | — | — |
| LivingAreaFeatures | `dryerException` | string | ja | — | 4 |
| LivingAreaFeatures | `electronicRoomKey` | boolean | ja | — | — |
| LivingAreaFeatures | `electronicRoomKeyException` | string | ja | — | 4 |
| LivingAreaFeatures | `fireplace` | boolean | ja | — | — |
| LivingAreaFeatures | `fireplaceException` | string | ja | — | 4 |
| LivingAreaFeatures | `hairdryer` | boolean | ja | — | — |
| LivingAreaFeatures | `hairdryerException` | string | ja | — | 4 |
| LivingAreaFeatures | `heating` | boolean | ja | — | — |
| LivingAreaFeatures | `heatingException` | string | ja | — | 4 |
| LivingAreaFeatures | `inunitSafe` | boolean | ja | — | — |
| LivingAreaFeatures | `inunitSafeException` | string | ja | — | 4 |
| LivingAreaFeatures | `inunitWifiAvailable` | boolean | ja | — | — |
| LivingAreaFeatures | `inunitWifiAvailableException` | string | ja | — | 4 |
| LivingAreaFeatures | `ironingEquipment` | boolean | ja | — | — |
| LivingAreaFeatures | `ironingEquipmentException` | string | ja | — | 4 |
| LivingAreaFeatures | `payPerViewMovies` | boolean | ja | — | — |
| LivingAreaFeatures | `payPerViewMoviesException` | string | ja | — | 4 |
| LivingAreaFeatures | `privateBathroom` | boolean | ja | — | — |
| LivingAreaFeatures | `privateBathroomException` | string | ja | — | 4 |
| LivingAreaFeatures | `shower` | boolean | ja | — | — |
| LivingAreaFeatures | `showerException` | string | ja | — | 4 |
| LivingAreaFeatures | `toilet` | boolean | ja | — | — |
| LivingAreaFeatures | `toiletException` | string | ja | — | 4 |
| LivingAreaFeatures | `tv` | boolean | ja | — | — |
| LivingAreaFeatures | `tvCasting` | boolean | ja | — | — |
| LivingAreaFeatures | `tvCastingException` | string | ja | — | 4 |
| LivingAreaFeatures | `tvException` | string | ja | — | 4 |
| LivingAreaFeatures | `tvStreaming` | boolean | ja | — | — |
| LivingAreaFeatures | `tvStreamingException` | string | ja | — | 4 |
| LivingAreaFeatures | `universalPowerAdapters` | boolean | ja | — | — |
| LivingAreaFeatures | `universalPowerAdaptersException` | string | ja | — | 4 |
| LivingAreaFeatures | `washer` | boolean | ja | — | — |
| LivingAreaFeatures | `washerException` | string | ja | — | 4 |
| LivingAreaLayout | `balcony` | boolean | ja | — | — |
| LivingAreaLayout | `balconyException` | string | ja | — | 4 |
| LivingAreaLayout | `livingAreaSqMeters` | number | ja | — | — |
| LivingAreaLayout | `livingAreaSqMetersException` | string | ja | — | 4 |
| LivingAreaLayout | `loft` | boolean | ja | — | — |
| LivingAreaLayout | `loftException` | string | ja | — | 4 |
| LivingAreaLayout | `nonSmoking` | boolean | ja | — | — |
| LivingAreaLayout | `nonSmokingException` | string | ja | — | 4 |
| LivingAreaLayout | `patio` | boolean | ja | — | — |
| LivingAreaLayout | `patioException` | string | ja | — | 4 |
| LivingAreaLayout | `stairs` | boolean | ja | — | — |
| LivingAreaLayout | `stairsException` | string | ja | — | 4 |
| LivingAreaSleeping | `bedsCount` | integer | ja | — | — |
| LivingAreaSleeping | `bedsCountException` | string | ja | — | 4 |
| LivingAreaSleeping | `bunkBedsCount` | integer | ja | — | — |
| LivingAreaSleeping | `bunkBedsCountException` | string | ja | — | 4 |
| LivingAreaSleeping | `cribsCount` | integer | ja | — | — |
| LivingAreaSleeping | `cribsCountException` | string | ja | — | 4 |
| LivingAreaSleeping | `doubleBedsCount` | integer | ja | — | — |
| LivingAreaSleeping | `doubleBedsCountException` | string | ja | — | 4 |
| LivingAreaSleeping | `featherPillows` | boolean | ja | — | — |
| LivingAreaSleeping | `featherPillowsException` | string | ja | — | 4 |
| LivingAreaSleeping | `hypoallergenicBedding` | boolean | ja | — | — |
| LivingAreaSleeping | `hypoallergenicBeddingException` | string | ja | — | 4 |
| LivingAreaSleeping | `kingBedsCount` | integer | ja | — | — |
| LivingAreaSleeping | `kingBedsCountException` | string | ja | — | 4 |
| LivingAreaSleeping | `memoryFoamPillows` | boolean | ja | — | — |
| LivingAreaSleeping | `memoryFoamPillowsException` | string | ja | — | 4 |
| LivingAreaSleeping | `otherBedsCount` | integer | ja | — | — |
| LivingAreaSleeping | `otherBedsCountException` | string | ja | — | 4 |
| LivingAreaSleeping | `queenBedsCount` | integer | ja | — | — |
| LivingAreaSleeping | `queenBedsCountException` | string | ja | — | 4 |
| LivingAreaSleeping | `rollAwayBedsCount` | integer | ja | — | — |
| LivingAreaSleeping | `rollAwayBedsCountException` | string | ja | — | 4 |
| LivingAreaSleeping | `singleOrTwinBedsCount` | integer | ja | — | — |
| LivingAreaSleeping | `singleOrTwinBedsCountException` | string | ja | — | 4 |
| LivingAreaSleeping | `sofaBedsCount` | integer | ja | — | — |
| LivingAreaSleeping | `sofaBedsCountException` | string | ja | — | 4 |
| LivingAreaSleeping | `syntheticPillows` | boolean | ja | — | — |
| LivingAreaSleeping | `syntheticPillowsException` | string | ja | — | 4 |
| Lodging | `accessibility` | Accessibility | ja | — | — |
| Lodging | `activities` | Activities | ja | — | — |
| Lodging | `allUnits` | GuestUnitFeatures | — | — | — |
| Lodging | `business` | Business | ja | — | — |
| Lodging | `commonLivingArea` | LivingArea | ja | — | — |
| Lodging | `connectivity` | Connectivity | ja | — | — |
| Lodging | `families` | Families | ja | — | — |
| Lodging | `foodAndDrink` | FoodAndDrink | ja | — | — |
| Lodging | `guestUnits` | GuestUnitType[] | ja | — | — |
| Lodging | `healthAndSafety` | HealthAndSafety | ja | — | — |
| Lodging | `housekeeping` | Housekeeping | ja | — | — |
| Lodging | `metadata` | LodgingMetadata | ja | — | — |
| Lodging | `name` | string | ja | — | — |
| Lodging | `parking` | Parking | ja | — | — |
| Lodging | `pets` | Pets | ja | — | — |
| Lodging | `policies` | Policies | ja | — | — |
| Lodging | `pools` | Pools | ja | — | — |
| Lodging | `property` | Property | ja | — | — |
| Lodging | `services` | Services | ja | — | — |
| Lodging | `someUnits` | GuestUnitFeatures | — | — | — |
| Lodging | `sustainability` | Sustainability | ja | — | — |
| Lodging | `transportation` | Transportation | ja | — | — |
| Lodging | `wellness` | Wellness | ja | — | — |
| LodgingMetadata | `updateTime` | string | ja | — | — |
| MinimizedContact | `contactlessCheckinCheckout` | boolean | ja | — | — |
| MinimizedContact | `contactlessCheckinCheckoutException` | string | ja | — | 4 |
| MinimizedContact | `digitalGuestRoomKeys` | boolean | ja | — | — |
| MinimizedContact | `digitalGuestRoomKeysException` | string | ja | — | 4 |
| MinimizedContact | `housekeepingScheduledRequestOnly` | boolean | ja | — | — |
| MinimizedContact | `housekeepingScheduledRequestOnlyException` | string | ja | — | 4 |
| MinimizedContact | `noHighTouchItemsCommonAreas` | boolean | ja | — | — |
| MinimizedContact | `noHighTouchItemsCommonAreasException` | string | ja | — | 4 |
| MinimizedContact | `noHighTouchItemsGuestRooms` | boolean | ja | — | — |
| MinimizedContact | `noHighTouchItemsGuestRoomsException` | string | ja | — | 4 |
| MinimizedContact | `plasticKeycardsDisinfected` | boolean | ja | — | — |
| MinimizedContact | `plasticKeycardsDisinfectedException` | string | ja | — | 4 |
| MinimizedContact | `roomBookingsBuffer` | boolean | ja | — | — |
| MinimizedContact | `roomBookingsBufferException` | string | ja | — | 4 |
| Parking | `electricCarChargingStations` | boolean | ja | — | — |
| Parking | `electricCarChargingStationsException` | string | ja | — | 4 |
| Parking | `freeParking` | boolean | ja | — | — |
| Parking | `freeParkingException` | string | ja | — | 4 |
| Parking | `freeSelfParking` | boolean | ja | — | — |
| Parking | `freeSelfParkingException` | string | ja | — | 4 |
| Parking | `freeValetParking` | boolean | ja | — | — |
| Parking | `freeValetParkingException` | string | ja | — | 4 |
| Parking | `parkingAvailable` | boolean | ja | — | — |
| Parking | `parkingAvailableException` | string | ja | — | 4 |
| Parking | `selfParkingAvailable` | boolean | ja | — | — |
| Parking | `selfParkingAvailableException` | string | ja | — | 4 |
| Parking | `valetParkingAvailable` | boolean | ja | — | — |
| Parking | `valetParkingAvailableException` | string | ja | — | 4 |
| PaymentOptions | `cash` | boolean | ja | — | — |
| PaymentOptions | `cashException` | string | ja | — | 4 |
| PaymentOptions | `cheque` | boolean | ja | — | — |
| PaymentOptions | `chequeException` | string | ja | — | 4 |
| PaymentOptions | `creditCard` | boolean | ja | — | — |
| PaymentOptions | `creditCardException` | string | ja | — | 4 |
| PaymentOptions | `debitCard` | boolean | ja | — | — |
| PaymentOptions | `debitCardException` | string | ja | — | 4 |
| PaymentOptions | `mobileNfc` | boolean | ja | — | — |
| PaymentOptions | `mobileNfcException` | string | ja | — | 4 |
| PersonalProtection | `commonAreasOfferSanitizingItems` | boolean | ja | — | — |
| PersonalProtection | `commonAreasOfferSanitizingItemsException` | string | ja | — | 4 |
| PersonalProtection | `faceMaskRequired` | boolean | ja | — | — |
| PersonalProtection | `faceMaskRequiredException` | string | ja | — | 4 |
| PersonalProtection | `guestRoomHygieneKitsAvailable` | boolean | ja | — | — |
| PersonalProtection | `guestRoomHygieneKitsAvailableException` | string | ja | — | 4 |
| PersonalProtection | `protectiveEquipmentAvailable` | boolean | ja | — | — |
| PersonalProtection | `protectiveEquipmentAvailableException` | string | ja | — | 4 |
| Pets | `catsAllowed` | boolean | ja | — | — |
| Pets | `catsAllowedException` | string | ja | — | 4 |
| Pets | `dogsAllowed` | boolean | ja | — | — |
| Pets | `dogsAllowedException` | string | ja | — | 4 |
| Pets | `petsAllowed` | boolean | ja | — | — |
| Pets | `petsAllowedException` | string | ja | — | 4 |
| Pets | `petsAllowedFree` | boolean | ja | — | — |
| Pets | `petsAllowedFreeException` | string | ja | — | 4 |
| PhysicalDistancing | `commonAreasPhysicalDistancingArranged` | boolean | ja | — | — |
| PhysicalDistancing | `commonAreasPhysicalDistancingArrangedException` | string | ja | — | 4 |
| PhysicalDistancing | `physicalDistancingRequired` | boolean | ja | — | — |
| PhysicalDistancing | `physicalDistancingRequiredException` | string | ja | — | 4 |
| PhysicalDistancing | `safetyDividers` | boolean | ja | — | — |
| PhysicalDistancing | `safetyDividersException` | string | ja | — | 4 |
| PhysicalDistancing | `sharedAreasLimitedOccupancy` | boolean | ja | — | — |
| PhysicalDistancing | `sharedAreasLimitedOccupancyException` | string | ja | — | 4 |
| PhysicalDistancing | `wellnessAreasHavePrivateSpaces` | boolean | ja | — | — |
| PhysicalDistancing | `wellnessAreasHavePrivateSpacesException` | string | ja | — | 4 |
| Policies | `allInclusiveAvailable` | boolean | ja | — | — |
| Policies | `allInclusiveAvailableException` | string | ja | — | 4 |
| Policies | `allInclusiveOnly` | boolean | ja | — | — |
| Policies | `allInclusiveOnlyException` | string | ja | — | 4 |
| Policies | `checkinTime` | TimeOfDay | ja | — | — |
| Policies | `checkinTimeException` | string | ja | — | 4 |
| Policies | `checkoutTime` | TimeOfDay | ja | — | — |
| Policies | `checkoutTimeException` | string | ja | — | 4 |
| Policies | `kidsStayFree` | boolean | ja | — | — |
| Policies | `kidsStayFreeException` | string | ja | — | 4 |
| Policies | `maxChildAge` | integer | ja | — | — |
| Policies | `maxChildAgeException` | string | ja | — | 4 |
| Policies | `maxKidsStayFreeCount` | integer | ja | — | — |
| Policies | `maxKidsStayFreeCountException` | string | ja | — | 4 |
| Policies | `paymentOptions` | PaymentOptions | ja | — | — |
| Policies | `smokeFreeProperty` | boolean | ja | — | — |
| Policies | `smokeFreePropertyException` | string | ja | — | 4 |
| Pools | `adultPool` | boolean | ja | — | — |
| Pools | `adultPoolException` | string | ja | — | 4 |
| Pools | `hotTub` | boolean | ja | — | — |
| Pools | `hotTubException` | string | ja | — | 4 |
| Pools | `indoorPool` | boolean | ja | — | — |
| Pools | `indoorPoolException` | string | ja | — | 4 |
| Pools | `indoorPoolsCount` | integer | ja | — | — |
| Pools | `indoorPoolsCountException` | string | ja | — | 4 |
| Pools | `lazyRiver` | boolean | ja | — | — |
| Pools | `lazyRiverException` | string | ja | — | 4 |
| Pools | `lifeguard` | boolean | ja | — | — |
| Pools | `lifeguardException` | string | ja | — | 4 |
| Pools | `outdoorPool` | boolean | ja | — | — |
| Pools | `outdoorPoolException` | string | ja | — | 4 |
| Pools | `outdoorPoolsCount` | integer | ja | — | — |
| Pools | `outdoorPoolsCountException` | string | ja | — | 4 |
| Pools | `pool` | boolean | ja | — | — |
| Pools | `poolException` | string | ja | — | 4 |
| Pools | `poolsCount` | integer | ja | — | — |
| Pools | `poolsCountException` | string | ja | — | 4 |
| Pools | `wadingPool` | boolean | ja | — | — |
| Pools | `wadingPoolException` | string | ja | — | 4 |
| Pools | `waterPark` | boolean | ja | — | — |
| Pools | `waterParkException` | string | ja | — | 4 |
| Pools | `waterslide` | boolean | ja | — | — |
| Pools | `waterslideException` | string | ja | — | 4 |
| Pools | `wavePool` | boolean | ja | — | — |
| Pools | `wavePoolException` | string | ja | — | 4 |
| Property | `builtYear` | integer | ja | — | — |
| Property | `builtYearException` | string | ja | — | 4 |
| Property | `floorsCount` | integer | ja | — | — |
| Property | `floorsCountException` | string | ja | — | 4 |
| Property | `lastRenovatedYear` | integer | ja | — | — |
| Property | `lastRenovatedYearException` | string | ja | — | 4 |
| Property | `roomsCount` | integer | ja | — | — |
| Property | `roomsCountException` | string | ja | — | 4 |
| Services | `baggageStorage` | boolean | ja | — | — |
| Services | `baggageStorageException` | string | ja | — | 4 |
| Services | `concierge` | boolean | ja | — | — |
| Services | `conciergeException` | string | ja | — | 4 |
| Services | `convenienceStore` | boolean | ja | — | — |
| Services | `convenienceStoreException` | string | ja | — | 4 |
| Services | `currencyExchange` | boolean | ja | — | — |
| Services | `currencyExchangeException` | string | ja | — | 4 |
| Services | `elevator` | boolean | ja | — | — |
| Services | `elevatorException` | string | ja | — | 4 |
| Services | `frontDesk` | boolean | ja | — | — |
| Services | `frontDeskException` | string | ja | — | 4 |
| Services | `fullServiceLaundry` | boolean | ja | — | — |
| Services | `fullServiceLaundryException` | string | ja | — | 4 |
| Services | `giftShop` | boolean | ja | — | — |
| Services | `giftShopException` | string | ja | — | 4 |
| Services | `languagesSpoken` | LanguageSpoken[] | ja | — | — |
| Services | `selfServiceLaundry` | boolean | ja | — | — |
| Services | `selfServiceLaundryException` | string | ja | — | 4 |
| Services | `socialHour` | boolean | ja | — | — |
| Services | `socialHourException` | string | ja | — | 4 |
| Services | `twentyFourHourFrontDesk` | boolean | ja | — | — |
| Services | `twentyFourHourFrontDeskException` | string | ja | — | 4 |
| Services | `wakeUpCalls` | boolean | ja | — | — |
| Services | `wakeUpCallsException` | string | ja | — | 4 |
| Sustainability | `energyEfficiency` | EnergyEfficiency | ja | — | — |
| Sustainability | `sustainabilityCertifications` | SustainabilityCertifications | ja | **ja** | — |
| Sustainability | `sustainableSourcing` | SustainableSourcing | ja | — | — |
| Sustainability | `wasteReduction` | WasteReduction | ja | — | — |
| Sustainability | `waterConservation` | WaterConservation | ja | — | — |
| SustainabilityCertifications | `breeamCertification` | string | ja | — | 7 |
| SustainabilityCertifications | `breeamCertificationException` | string | ja | — | 4 |
| SustainabilityCertifications | `ecoCertifications` | EcoCertification[] | ja | — | — |
| SustainabilityCertifications | `leedCertification` | string | ja | — | 6 |
| SustainabilityCertifications | `leedCertificationException` | string | ja | — | 4 |
| SustainableSourcing | `ecoFriendlyToiletries` | boolean | ja | — | — |
| SustainableSourcing | `ecoFriendlyToiletriesException` | string | ja | — | 4 |
| SustainableSourcing | `locallySourcedFoodAndBeverages` | boolean | ja | — | — |
| SustainableSourcing | `locallySourcedFoodAndBeveragesException` | string | ja | — | 4 |
| SustainableSourcing | `organicCageFreeEggs` | boolean | ja | — | — |
| SustainableSourcing | `organicCageFreeEggsException` | string | ja | — | 4 |
| SustainableSourcing | `organicFoodAndBeverages` | boolean | ja | — | — |
| SustainableSourcing | `organicFoodAndBeveragesException` | string | ja | — | 4 |
| SustainableSourcing | `responsiblePurchasingPolicy` | boolean | ja | — | — |
| SustainableSourcing | `responsiblePurchasingPolicyException` | string | ja | — | 4 |
| SustainableSourcing | `responsiblySourcesSeafood` | boolean | ja | — | — |
| SustainableSourcing | `responsiblySourcesSeafoodException` | string | ja | — | 4 |
| SustainableSourcing | `veganMeals` | boolean | ja | — | — |
| SustainableSourcing | `veganMealsException` | string | ja | — | 4 |
| SustainableSourcing | `vegetarianMeals` | boolean | ja | — | — |
| SustainableSourcing | `vegetarianMealsException` | string | ja | — | 4 |
| TimeOfDay | `hours` | integer | ja | — | — |
| TimeOfDay | `minutes` | integer | ja | — | — |
| TimeOfDay | `nanos` | integer | ja | — | — |
| TimeOfDay | `seconds` | integer | ja | — | — |
| Transportation | `airportShuttle` | boolean | ja | — | — |
| Transportation | `airportShuttleException` | string | ja | — | 4 |
| Transportation | `carRentalOnProperty` | boolean | ja | — | — |
| Transportation | `carRentalOnPropertyException` | string | ja | — | 4 |
| Transportation | `freeAirportShuttle` | boolean | ja | — | — |
| Transportation | `freeAirportShuttleException` | string | ja | — | 4 |
| Transportation | `freePrivateCarService` | boolean | ja | — | — |
| Transportation | `freePrivateCarServiceException` | string | ja | — | 4 |
| Transportation | `localShuttle` | boolean | ja | — | — |
| Transportation | `localShuttleException` | string | ja | — | 4 |
| Transportation | `privateCarService` | boolean | ja | — | — |
| Transportation | `privateCarServiceException` | string | ja | — | 4 |
| Transportation | `transfer` | boolean | ja | — | — |
| Transportation | `transferException` | string | ja | — | 4 |
| ViewsFromUnit | `beachView` | boolean | ja | — | — |
| ViewsFromUnit | `beachViewException` | string | ja | — | 4 |
| ViewsFromUnit | `cityView` | boolean | ja | — | — |
| ViewsFromUnit | `cityViewException` | string | ja | — | 4 |
| ViewsFromUnit | `gardenView` | boolean | ja | — | — |
| ViewsFromUnit | `gardenViewException` | string | ja | — | 4 |
| ViewsFromUnit | `lakeView` | boolean | ja | — | — |
| ViewsFromUnit | `lakeViewException` | string | ja | — | 4 |
| ViewsFromUnit | `landmarkView` | boolean | ja | — | — |
| ViewsFromUnit | `landmarkViewException` | string | ja | — | 4 |
| ViewsFromUnit | `oceanView` | boolean | ja | — | — |
| ViewsFromUnit | `oceanViewException` | string | ja | — | 4 |
| ViewsFromUnit | `poolView` | boolean | ja | — | — |
| ViewsFromUnit | `poolViewException` | string | ja | — | 4 |
| ViewsFromUnit | `valleyView` | boolean | ja | — | — |
| ViewsFromUnit | `valleyViewException` | string | ja | — | 4 |
| WasteReduction | `compostableFoodContainersAndCutlery` | boolean | ja | — | — |
| WasteReduction | `compostableFoodContainersAndCutleryException` | string | ja | — | 4 |
| WasteReduction | `compostsExcessFood` | boolean | ja | — | — |
| WasteReduction | `compostsExcessFoodException` | string | ja | — | 4 |
| WasteReduction | `donatesExcessFood` | boolean | ja | — | — |
| WasteReduction | `donatesExcessFoodException` | string | ja | — | 4 |
| WasteReduction | `foodWasteReductionProgram` | boolean | ja | — | — |
| WasteReduction | `foodWasteReductionProgramException` | string | ja | — | 4 |
| WasteReduction | `noSingleUsePlasticStraws` | boolean | ja | — | — |
| WasteReduction | `noSingleUsePlasticStrawsException` | string | ja | — | 4 |
| WasteReduction | `noSingleUsePlasticWaterBottles` | boolean | ja | — | — |
| WasteReduction | `noSingleUsePlasticWaterBottlesException` | string | ja | — | 4 |
| WasteReduction | `noStyrofoamFoodContainers` | boolean | ja | — | — |
| WasteReduction | `noStyrofoamFoodContainersException` | string | ja | — | 4 |
| WasteReduction | `recyclingProgram` | boolean | ja | — | — |
| WasteReduction | `recyclingProgramException` | string | ja | — | 4 |
| WasteReduction | `refillableToiletryContainers` | boolean | ja | — | — |
| WasteReduction | `refillableToiletryContainersException` | string | ja | — | 4 |
| WasteReduction | `safelyDisposesBatteries` | boolean | ja | — | — |
| WasteReduction | `safelyDisposesBatteriesException` | string | ja | — | 4 |
| WasteReduction | `safelyDisposesElectronics` | boolean | ja | — | — |
| WasteReduction | `safelyDisposesElectronicsException` | string | ja | — | 4 |
| WasteReduction | `safelyDisposesLightbulbs` | boolean | ja | — | — |
| WasteReduction | `safelyDisposesLightbulbsException` | string | ja | — | 4 |
| WasteReduction | `safelyHandlesHazardousSubstances` | boolean | ja | — | — |
| WasteReduction | `safelyHandlesHazardousSubstancesException` | string | ja | — | 4 |
| WasteReduction | `soapDonationProgram` | boolean | ja | — | — |
| WasteReduction | `soapDonationProgramException` | string | ja | — | 4 |
| WasteReduction | `toiletryDonationProgram` | boolean | ja | — | — |
| WasteReduction | `toiletryDonationProgramException` | string | ja | — | 4 |
| WasteReduction | `waterBottleFillingStations` | boolean | ja | — | — |
| WasteReduction | `waterBottleFillingStationsException` | string | ja | — | 4 |
| WaterConservation | `independentOrganizationAuditsWaterUse` | boolean | ja | — | — |
| WaterConservation | `independentOrganizationAuditsWaterUseException` | string | ja | — | 4 |
| WaterConservation | `linenReuseProgram` | boolean | ja | — | — |
| WaterConservation | `linenReuseProgramException` | string | ja | — | 4 |
| WaterConservation | `towelReuseProgram` | boolean | ja | — | — |
| WaterConservation | `towelReuseProgramException` | string | ja | — | 4 |
| WaterConservation | `waterSavingShowers` | boolean | ja | — | — |
| WaterConservation | `waterSavingShowersException` | string | ja | — | 4 |
| WaterConservation | `waterSavingSinks` | boolean | ja | — | — |
| WaterConservation | `waterSavingSinksException` | string | ja | — | 4 |
| WaterConservation | `waterSavingToilets` | boolean | ja | — | — |
| WaterConservation | `waterSavingToiletsException` | string | ja | — | 4 |
| Wellness | `doctorOnCall` | boolean | ja | — | — |
| Wellness | `doctorOnCallException` | string | ja | — | 4 |
| Wellness | `ellipticalMachine` | boolean | ja | — | — |
| Wellness | `ellipticalMachineException` | string | ja | — | 4 |
| Wellness | `fitnessCenter` | boolean | ja | — | — |
| Wellness | `fitnessCenterException` | string | ja | — | 4 |
| Wellness | `freeFitnessCenter` | boolean | ja | — | — |
| Wellness | `freeFitnessCenterException` | string | ja | — | 4 |
| Wellness | `freeWeights` | boolean | ja | — | — |
| Wellness | `freeWeightsException` | string | ja | — | 4 |
| Wellness | `massage` | boolean | ja | — | — |
| Wellness | `massageException` | string | ja | — | 4 |
| Wellness | `salon` | boolean | ja | — | — |
| Wellness | `salonException` | string | ja | — | 4 |
| Wellness | `sauna` | boolean | ja | — | — |
| Wellness | `saunaException` | string | ja | — | 4 |
| Wellness | `spa` | boolean | ja | — | — |
| Wellness | `spaException` | string | ja | — | 4 |
| Wellness | `treadmill` | boolean | ja | — | — |
| Wellness | `treadmillException` | string | ja | — | 4 |
| Wellness | `weightMachine` | boolean | ja | — | — |
| Wellness | `weightMachineException` | string | ja | — | 4 |

---

## Was dieser Bericht NICHT aussagt

Er prüft ausschließlich die **öffentlichen Spezifikationen**. Er sagt nichts darüber,
ob eine API im Google-Cloud-Projekt aktiviert ist, ob eine Quota vergeben wurde oder
ob ein Aufruf mit echtem Token funktioniert. Das beantwortet nur die Cloud Console
oder ein authentifizierter Funktionstest — siehe `docs/google-api-inventory.md`,
Abschnitt „Google-Cloud-Freigaben".
