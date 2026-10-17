# myfactory – Stammdaten-Masken (ausgelesen 17.10.2026, Demo wfData_demo)
Format: Beschriftung [Feldtyp #interner Feldname]. Die internen Namen kommen aus den Element-IDs der Maske (Präfix txt/cbo/chk entfernt).

# Artikel (Base/BaseEditMain.asp?EditName=BaseProducts) – 9420 Artikel in der Demo
Reiter: Übersicht | Grundlagen | Einkauf/Verkauf | Preise | Rabatte | Dokumente | Bestände | Dimensionen | Kennzeichen | Kataloge | Kosten | Gefahrgut | Intrastat | Historie
Knöpfe: Neu | Kopieren | Löschen | Memotext ; Menüs Daten / Info / Aktionen ; Suche: Filter/Suche, Erweiterte Suche, Volltextsuche, Kennzeichen ; Ansichten umschaltbar

## Grundlagen
Artikelnummer [#ProductNumber] | Favorit [chk #IsFavorite] | Inaktiv [chk #InActive] | Kurzbezeichnung [#Matchcode] | Zusatz [#MatchcodeAdd] | Bezeichnung [#Name1] | Bezeichnung (Zusatz) [#Name2] | Artikelstatus [Auswahl #ProductState] | Statustext [#ProductStateText] | Artikeltyp [Auswahl #ProductType] | Basismengeneinheit BME [Auswahl #BaseUnit] | Dezimalstellen BME [#BaseDecimals] | Länge/Breite/Höhe cm [#ProductLength/#ProductWidth/#ProductHeight] | Artikelgruppe [#ProductGroup] | Steuerklasse [#Taxation] | Marketing-Score [#MarketingScore] | Gewicht + Einheit [#ProductWeight #WeightUnit] | Nettogewicht (Zoll) [#ProductNetWeight] | Projekt-Zeitabrechnung [chk #UseForTimeInput] | Mengenformel [#QuantityFormula] | ABC-Klasse [#ABCCategory] | Text-Platzhalter ersetzen [chk] | EAN/GTIN [#EANNumber] | Zolltarifnummer [#DutyRateNumber] | Ursprungsland [#OriginCountry] | Meldebestand [#StockNotification] | Maximalbestand [#StockNotificationMax] | Gesamtlagerbestand [#Stock] | Betriebsstätte [#Division] | Zugriffskennzeichen [#AccessFlag]

## Einkauf/Verkauf
Einmalartikel [#IsManual] | ME für Preisangaben (PAngV) [#PriceBaseUnit, #PriceBaseUnitConversion] | Verkaufsmengeneinheit [#SalesUnit] | Verkaufspreisbasis [#SalesPriceUnit] | Preiseinheit Verkauf [#PriceUnit] | Nicht umsatzwirksam VK/EK [#NoTurnover/#NoTurnoverPurchase] | Als Set-Bestandteil [#HideCombinationPart] | Mindestverkaufsmenge [#SalesMinQuantity] | Gebindemenge [#SalesBundleQuantity] | Produktionsmengeneinheit [#ProductionUnit] | Verbrauchsmengeneinheit [#ConsumptionUnit] | Hersteller [#ManufacturerID] | Hersteller-ArtikelNr [#ManufacturerNumber] | Preis-/Rabattgruppe [#PriceGroup] | Rabattfähig im VK [#GetsDiscount] | Provisionierbar [#GetsCommission] | Standardpreisaufschlag % [#PriceMarkup] | Dezimalstellen Preis [#PriceDecimals] | Skontoabzug [#NotCashDiscountable] | Beschaffungszeit Tage [#ProcurementTime] | Disposition [#PurchaseProposalType] | Dispositionsfaktor [#ProposalFactor] | Mindestdispositionsmenge [#ProposalQuantity] | Dispositionskennzeichen [#ProposalFlag] | Kalkulationsschema [#CalculationScheme] | Variantenpreise [#VariantPrices] | Basis Roherlösermittlung [#RevenueBase] | Ersatz für Mittleren Wert [#ReplaceMeanPurchasePrice] | Ersatz für interner Wert = 0 [#ReplaceNullValuation] | Roherlös auf Basis Lagerwert [#SalesValuationPriceFromStock] | Interne Position [#IsInternalPos] | Wareneinsatzbuchungen [#UseProductStockBooking] | Bestellvorschlag als Artikel [#ProposeAsProduct] | Materialentnahme statt Unterauftrag [#NoPPSSubOrderCreating] | Sachkonten: Wareneinsatz/Warenbestand/Bestandsveränderung/Verkauf/Einkauf [#ProductCostAccountID #ProductStockAccountID #ProductInventoryChangeAccountID #SalesAccountID #PurchaseAccountID] | Kostenstelle [#CostCenter] | Kostenträger [#CostObjective] | Erlöscode [#RevenueCode] | Eingangscode [#ExpenseCode]

## Preise
Tabelle je Zeile: Preisliste [#PriceListID_Rn] | Währung [#CurrUnit_Rn] | Preis [#Price_Rn]  (9 Zeilen sichtbar → Artikelpreis je Preisliste)
## Rabatte
Tabelle: Rabattliste [#DiscountListID_Rn] | Rabatt [#Discount_Rn]
## Bestände
Lagermengeneinheit [#StockUnit] | Negative Bestände [#AllowNegative] | Sperre [#LockTypes] | Bestandsführung [#StockWithDrawalType] | Bewertungsverfahren [#StockWithDrawalProcedure] | Betriebsstättenabhängig [#DivisionDependency] | Hauptlager [#MainWarehouse, #MainWarehouseDiv] | Lagerbestand | Bewertungen (je gesamt + je Betriebsstätte + Währung): interner Wert [#ValuationPrice], Durchschnittl. Bestand [#AverageStockPrice], Letzter EK [#LastPurchasePrice], Durchschnittl. EK [#AveragePurchasePrice], Mittlerer Wert MEK [#MeanPurchasePrice], Letzte Produktion [#LastManufacturingPrice], Durchschnittl. Produktion [#AverageManufacturingPrice], Kalkulatorischer EK 1+2 [#CalcPurchasePrice, #CalcPurchasePrice2]
## Kennzeichen (frei definierbare Zusatzfelder, Typen: Ja/Nein, Text, Zahl, Datum, Auswahl)
Beispiele Demo: Auslauf-Artikel | im Prospekt enthalten | im Sortiment seit | Tiefster Lagerwert | Innen-/Außendurchmesser mm | Breite mm  → Liste lstAttributes, Feld AttributeValue
## Gefahrgut
UN-Nummer [#DGUNNumber] | Gefahrgutklasse [#DGClass] | Nebengefahr 1/2 | Gefahrgutbezeichnung | N.A.G. | Klassifizierungscode | Verpackungsgruppe | Gefahrgutverpackungscode | Zusatz-Verpackungstext | Tunnelbeschränkungscode | Eurotunnel | Beförderungskategorie | LQ-Grenze | LQ/Gefahrgut/SV188 | Zuschlagsartikel
## Intrastat
Warennummer [#IntraCommodityID] | Ursprungsland Eingang | Ursprungsregion Versand | Warenbezeichnung | Eigenmasse | Statist. Wert Versand/Eingang + Meldewährung | Statist. Verfahren Eingang/Versendung | Abweichende Mengeneinheit + Faktor
## Übersicht, Dokumente, Dimensionen (Varianten), Kataloge, Kosten, Historie
Listen-/Info-Reiter ohne eigene Eingabefelder (Übersicht = ProductInfoPage, Kosten = Valuation.aspx).

# Kunden (EditName=BaseCustomers)
Reiter: Übersicht | Adresse | Kundendaten | Kommunikation | Druckdaten | Ansprechpartner | Kennzeichen | Verlauf | Kontakte | Branchen | Notizen/Stichworte | Klassifizierung | Dokumente | Portal | Adressnachweis | Überlassungen | Historie | Social
→ Kunde = Rolle auf einer gemeinsamen ADRESSE (Adressnummer + Kundennummer getrennt).

## Adresse (gemeinsam für Kunde/Lieferant/Interessent)
Kundennummer [#CustomerNumber] | Adressnummer [#AddressNumber] | Kurzbezeichnung + Zusatz [#Matchcode #MatchcodeAdd] | Privatadresse [#IsPrivateAddress] | Anrede [#AddrTitle] | Titel [#AddrContactTitle] | Name + Zusatz [#Name1 #Name2] | Straße + Zusatz [#Street #Street2] | Land/PLZ/Ort [#Country #PostalCode #City] | Postfach/PLZ/Ort [#POBox #POPostalCode #POCity] | Telefon [#PhoneNr] | Fax [#FaxNr] | E-Mail [#EMail] | Homepage
## Kundendaten
Kundengruppe [#CustomerGroup] | Favorit | Inaktiv | Vertreter [#Representative] | Referenznummer | Betriebsstätte [#Division] | Steuernummer [#TaxNumber] | Handelsregister [#TradeNumber] | ABC-Klasse | Währung [#CurrencyUnit] | Kreditlimit [#CreditLimit] | Provisionsfähig | Rechnungsempfänger [#InvoiceTo → andere Adresse] | Zentralregulierer [#CentralTransactor] + Referenz | Versandart [#ShipmentCondition] | Lieferbedingung [#DeliveryCondition] | Teillieferungen [#PartDelivery] | Sperrkennzeichen [#FreezeType] | Liefersperre [#IsFreezed] | Bestellrhythmus [#OrderCycle] | Tour [#TourID] | Gebiet [#SalesDistrictID] | Kundenlager [#DefaultWarehouse] | Steuergebiet [#Taxation] | EU-Land [#TaxEUCountry] | EU-USt-ID [#EUVATNumber] | Preisliste [#PriceListID] | Rabattliste [#DiscountListID] | Rabatt % [#Discount] | Preiskennzeichen [#PriceType] | Preis-/Rabattgruppe [#PriceGroup] | Zusatzrabatt % [#AddDiscount] | Rabatte ausweisen [#ShowDiscounts] | Servicevereinbarung [#ServiceLevelAgreement] | EORI-Nummer | Rechnungskreis (Sammelrechnung) [#CollectiveInvoiceType] | Letzter Umsatz [#LastActivity] | DATEV-Kontonummer [#DatevAccount] | Erlöscode [#RevenueCode] | Sammelkonto [#GroupAccount] | EU-Dreiecksgeschäfte | Zahlungskonditionen [#PaymentConditions] | Mahnkonditionen [#ReminderCondition] | Letzte Mahnung | Kostenstelle | Kostenträger | Zahlungsmoral [#PaymentBehavior]
## Kommunikation
Sprache [#Language] | Briefanrede [#FormOfAddress] | Zu Händen | Position | Abteilung | Mobil | Telefon privat | Telefon 2 | Autotelefon | Kommunikation 1–4 | DUNS-Nr | GLN-Nr | Besuchsgruppe | Marketing-Score | Von Newslettern ausschließen | Newsletter-Anmeldestatus + Datum + Referenzart/Referenz + Zustimmungstext (DSGVO-Nachweis Double-Opt-In)
## Druckdaten
Druckgruppe | Beleg-Smart-Report | Beleg-Druckvariante | ZUGFeRD-Daten in Belegen [#AddZugferd] | Leitweg-ID [#BuyerReference] | XRechnung [#UseXInvoice] | Dokumente in XRechnung/PDF-Rechnung einbinden
## Kennzeichen (Zusatzfelder, Demo): Presseverteiler | Weihnachtsgeschenk? | Hotlinevertrag | Servicevertrag | Anzahl Arbeitsplätze/Mitarbeiter/Standorte | Datum Erstkontakt | Umsatz in Euro
## Portal: Portal-Zugang [#CMSEntry] | Login per URL-Parameter | Zwei-Faktor-Authentifizierung
## Social: Xing | LinkedIn | Twitter | Facebook | YouTube | Pinterest
## Listen-Reiter: Ansprechpartner | Verlauf | Kontakte | Branchen | Notizen/Stichworte | Klassifizierung | Dokumente | Adressnachweis | Überlassungen | Historie

# Lieferanten (EditName=BaseSuppliers)
Reiter: Übersicht | Adresse | Lieferantendaten | Kommunikation | Ansprechpartner | Kennzeichen | Verlauf | Kontakte | Notizen/Stichworte | Dokumente | Adressnachweis | Portal | Klassifizierung | Historie | Social
## Lieferantendaten
Favorit | Währung | Inaktiv | Lieferantengruppe [#SupplierGroup] | Vertreter | Steuergebiet | EU-Land | EU-USt-ID | EORI | Preiskennzeichen | Versandart | Lieferbedingung | Zahlungskonditionen | Tour | Gebiet | Zusatzrabattberechnung [#AdditionalDiscountMethod] | Standard-Rabatt % [#DefaultDiscount] | Rabatte nicht ausweisen | Liefersperre | Lieferantenlager | Zahlungssperre [#IsPaymentBlocked] | Druckgruppe | Beleg-Smart-Report | Beleg-Druckvariante | ABC-Klasse | Mindestbestellwert [#MinOrderValue] | Letzter Umsatz | Unsere Kundennummer [#ReferenceNumber] | Betriebsstätte | Abw. Rechnungssteller [#InvoiceFrom] | Steuernummer | Handelsregister | Kostenstelle | Kostenträger | DATEV-Konto | Eingangscode [#ExpenseCode] | Sammelkonto | Standard-Sachkonto [#DefaultImpersonalAccountID]
(Adresse/Kommunikation identisch zu Kunden)
