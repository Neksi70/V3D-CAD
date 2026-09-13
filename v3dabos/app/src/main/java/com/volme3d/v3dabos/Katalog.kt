package com.volme3d.v3dabos

/**
 * Bekannte Abo-Dienste.
 *
 * [paket] steuert die automatische Erkennung: ist die App installiert, schlägt V3D Abos
 * den Dienst vor und misst seine Benutzung. Wo der Paketname nicht sicher bekannt ist,
 * steht er leer — der Dienst taucht dann nur in der Auswahlliste beim Anlegen auf.
 *
 * [richtpreisCent] ist ein Vorschlag zum Überschreiben, kein Tarifstand. Preise ändern
 * sich ständig; maßgeblich ist immer der Betrag auf dem Kontoauszug.
 *
 * [buchung] sind Textbausteine, wie der Dienst auf dem Kontoauszug auftaucht — damit
 * findet der Kontoauszug-Import die Buchungen wieder.
 */
data class KatalogEintrag(
    val name: String,
    val anbieter: String,
    val paket: String = "",
    val richtpreisCent: Long = 0,
    val intervall: Intervall = Intervall.MONATLICH,
    val weg: Weg = Weg.WEB,
    val webUrl: String = "",
    val buchung: List<String> = emptyList()
)

object Katalog {
    val eintraege: List<KatalogEintrag> = listOf(
        // --- Video ---
        KatalogEintrag("Netflix", "Netflix International B.V.", "com.netflix.mediaclient",
            1399, Intervall.MONATLICH, Weg.WEB, "https://www.netflix.com/cancelplan", listOf("netflix")),
        KatalogEintrag("Disney+", "The Walt Disney Company", "com.disney.disneyplus",
            999, Intervall.MONATLICH, Weg.WEB, "https://www.disneyplus.com/account/subscription", listOf("disney")),
        KatalogEintrag("Amazon Prime", "Amazon EU S.à r.l.", "com.amazon.avod.thirdpartyclient",
            8990, Intervall.JAEHRLICH, Weg.WEB, "https://www.amazon.de/mc", listOf("amazon prime", "amzn prime", "prime de")),
        KatalogEintrag("WOW / Sky", "Sky Deutschland", "",
            999, Intervall.MONATLICH, Weg.WEB, "https://www.wowtv.de", listOf("sky deutsch", "wow ")),
        KatalogEintrag("DAZN", "DAZN Limited", "com.dazn",
            2499, Intervall.MONATLICH, Weg.WEB, "https://www.dazn.com/account", listOf("dazn")),
        KatalogEintrag("RTL+", "RTL Deutschland", "",
            699, Intervall.MONATLICH, Weg.WEB, "https://plus.rtl.de", listOf("rtl+", "rtl plus", "tvnow")),
        KatalogEintrag("Joyn PLUS+", "Joyn GmbH", "de.prosiebensat1digital.seventv",
            699, Intervall.MONATLICH, Weg.WEB, "https://www.joyn.de", listOf("joyn")),
        KatalogEintrag("Apple TV+", "Apple", "",
            999, Intervall.MONATLICH, Weg.WEB, "https://tv.apple.com", listOf("apple.com/bill", "itunes")),
        KatalogEintrag("Paramount+", "Paramount", "com.cbs.ott",
            799, Intervall.MONATLICH, Weg.WEB, "https://www.paramountplus.com", listOf("paramount")),
        KatalogEintrag("Crunchyroll", "Sony Pictures", "com.crunchyroll.crunchyroid",
            699, Intervall.MONATLICH, Weg.WEB, "https://www.crunchyroll.com/account", listOf("crunchyroll")),
        KatalogEintrag("YouTube Premium", "Google", "com.google.android.youtube",
            1299, Intervall.MONATLICH, Weg.PLAY, "https://www.youtube.com/paid_memberships", listOf("google youtube", "youtubepremium")),

        // --- Musik & Hörbuch ---
        KatalogEintrag("Spotify", "Spotify AB", "com.spotify.music",
            1099, Intervall.MONATLICH, Weg.WEB, "https://www.spotify.com/account/subscription/", listOf("spotify")),
        KatalogEintrag("Apple Music", "Apple", "com.apple.android.music",
            1099, Intervall.MONATLICH, Weg.WEB, "https://music.apple.com", listOf("apple.com/bill", "itunes")),
        KatalogEintrag("Amazon Music Unlimited", "Amazon", "com.amazon.mp3",
            1099, Intervall.MONATLICH, Weg.WEB, "https://www.amazon.de/music/settings", listOf("amazon music", "amazon digital")),
        KatalogEintrag("Deezer", "Deezer S.A.", "deezer.android.app",
            1199, Intervall.MONATLICH, Weg.WEB, "https://www.deezer.com/account", listOf("deezer")),
        KatalogEintrag("Audible", "Audible GmbH", "com.audible.application",
            999, Intervall.MONATLICH, Weg.WEB, "https://www.audible.de/account", listOf("audible")),
        KatalogEintrag("YouTube Music", "Google", "com.google.android.apps.youtube.music",
            1099, Intervall.MONATLICH, Weg.PLAY, "https://music.youtube.com", listOf("google youtube")),

        // --- Speicher & Büro ---
        KatalogEintrag("Google One", "Google", "com.google.android.apps.subscriptions.red",
            199, Intervall.MONATLICH, Weg.PLAY, "https://one.google.com/storage", listOf("google one", "google storage")),
        KatalogEintrag("Dropbox", "Dropbox Inc.", "com.dropbox.android",
            1199, Intervall.MONATLICH, Weg.WEB, "https://www.dropbox.com/account/plan", listOf("dropbox")),
        KatalogEintrag("Microsoft 365", "Microsoft", "com.microsoft.office.officehubrow",
            9900, Intervall.JAEHRLICH, Weg.WEB, "https://account.microsoft.com/services", listOf("microsoft", "msft")),
        KatalogEintrag("iCloud+", "Apple", "",
            299, Intervall.MONATLICH, Weg.WEB, "https://www.icloud.com", listOf("apple.com/bill", "icloud")),
        KatalogEintrag("Adobe Creative Cloud", "Adobe", "com.adobe.lrmobile",
            6499, Intervall.MONATLICH, Weg.WEB, "https://account.adobe.com/plans", listOf("adobe")),
        KatalogEintrag("Canva Pro", "Canva", "com.canva.editor",
            1199, Intervall.MONATLICH, Weg.WEB, "https://www.canva.com/settings/billing", listOf("canva")),
        KatalogEintrag("Evernote", "Evernote Corp.", "com.evernote",
            1099, Intervall.MONATLICH, Weg.WEB, "https://www.evernote.com/Settings.action", listOf("evernote")),
        KatalogEintrag("Notion", "Notion Labs", "notion.id",
            1000, Intervall.MONATLICH, Weg.WEB, "https://www.notion.so", listOf("notion")),
        KatalogEintrag("Todoist Pro", "Doist", "com.todoist",
            400, Intervall.MONATLICH, Weg.WEB, "https://todoist.com/prefs/subscription", listOf("todoist", "doist")),

        // --- KI & Entwicklung ---
        KatalogEintrag("ChatGPT Plus", "OpenAI", "com.openai.chatgpt",
            2300, Intervall.MONATLICH, Weg.WEB, "https://chat.openai.com", listOf("openai")),
        KatalogEintrag("Claude Pro", "Anthropic", "com.anthropic.claude",
            2000, Intervall.MONATLICH, Weg.WEB, "https://claude.ai/settings/billing", listOf("anthropic", "claude")),
        KatalogEintrag("GitHub Copilot", "GitHub / Microsoft", "com.github.android",
            1000, Intervall.MONATLICH, Weg.WEB, "https://github.com/settings/billing", listOf("github")),

        // --- Sport, Gesundheit, Lernen ---
        KatalogEintrag("Strava", "Strava Inc.", "com.strava",
            999, Intervall.MONATLICH, Weg.WEB, "https://www.strava.com/settings/subscription", listOf("strava")),
        KatalogEintrag("Komoot Premium", "komoot GmbH", "de.komoot.android",
            5999, Intervall.JAEHRLICH, Weg.WEB, "https://www.komoot.de", listOf("komoot")),
        KatalogEintrag("adidas Running", "Runtastic", "com.runtastic.android",
            999, Intervall.MONATLICH, Weg.PLAY, "", listOf("runtastic", "adidas run")),
        KatalogEintrag("MyFitnessPal", "MyFitnessPal Inc.", "com.myfitnesspal.android",
            1499, Intervall.MONATLICH, Weg.PLAY, "", listOf("myfitnesspal")),
        KatalogEintrag("Headspace", "Headspace Inc.", "com.getsomeheadspace.android",
            1299, Intervall.MONATLICH, Weg.WEB, "https://www.headspace.com/subscription", listOf("headspace")),
        KatalogEintrag("Calm", "Calm.com", "com.calm.android",
            4999, Intervall.JAEHRLICH, Weg.WEB, "https://www.calm.com/profile", listOf("calm.com", "calm inc")),
        KatalogEintrag("Duolingo Super", "Duolingo Inc.", "com.duolingo",
            1299, Intervall.MONATLICH, Weg.PLAY, "https://www.duolingo.com/settings", listOf("duolingo")),
        KatalogEintrag("Babbel", "Babbel GmbH", "com.babbel.mobile.android.en",
            1299, Intervall.MONATLICH, Weg.WEB, "https://my.babbel.com", listOf("babbel", "lesson nine")),
        KatalogEintrag("Fitnessstudio", "", "", 2990, Intervall.MONATLICH, Weg.EMAIL, "",
            listOf("fitness", "mcfit", "fitx", "clever fit", "john reed")),

        // --- Nachrichten ---
        KatalogEintrag("SPIEGEL+", "DER SPIEGEL", "de.spiegel.android.app.spon",
            2299, Intervall.MONATLICH, Weg.WEB, "https://abo.spiegel.de", listOf("spiegel")),
        KatalogEintrag("ZEIT Digital", "ZEIT Verlag", "", 2495, Intervall.MONATLICH, Weg.EMAIL,
            "https://premium.zeit.de", listOf("zeit verlag", "zeit online")),
        KatalogEintrag("BILDplus", "Axel Springer", "", 799, Intervall.MONATLICH, Weg.WEB,
            "https://www.bild.de/konto", listOf("bild", "axel springer")),
        KatalogEintrag("Tageszeitung (lokal)", "", "", 4500, Intervall.MONATLICH, Weg.EMAIL, "",
            listOf("zeitung", "verlag", "medienhaus")),

        // --- Kommunikation, Sicherheit, Sonstiges ---
        KatalogEintrag("NordVPN", "Nord Security", "com.nordvpn.android",
            1199, Intervall.MONATLICH, Weg.WEB, "https://my.nordaccount.com", listOf("nordvpn", "nord security")),
        KatalogEintrag("1Password", "AgileBits", "com.onepassword.android",
            299, Intervall.MONATLICH, Weg.WEB, "https://my.1password.com", listOf("1password", "agilebits")),
        KatalogEintrag("LinkedIn Premium", "LinkedIn", "com.linkedin.android",
            2999, Intervall.MONATLICH, Weg.WEB, "https://www.linkedin.com/premium", listOf("linkedin")),
        KatalogEintrag("XING Premium", "New Work SE", "com.xing.android",
            999, Intervall.MONATLICH, Weg.WEB, "https://www.xing.com/settings", listOf("xing", "new work se")),
        KatalogEintrag("Tinder Plus/Gold", "Match Group", "com.tinder",
            1999, Intervall.MONATLICH, Weg.PLAY, "", listOf("tinder", "match group")),
        KatalogEintrag("Plex Pass", "Plex Inc.", "com.plexapp.android",
            4999, Intervall.JAEHRLICH, Weg.WEB, "https://www.plex.tv/subscription", listOf("plex")),
        KatalogEintrag("Mobilfunkvertrag", "", "", 2999, Intervall.MONATLICH, Weg.EMAIL, "",
            listOf("telekom", "vodafone", "o2 ", "telefonica", "congstar", "1&1", "winsim", "aldi talk")),
        KatalogEintrag("Versicherung", "", "", 0, Intervall.MONATLICH, Weg.EMAIL, "",
            listOf("versicherung", "allianz", "huk", "ergo ", "axa ", "devk")),
    )

    /** Katalogeintrag zu einem Paketnamen, falls bekannt. */
    fun zuPaket(paket: String): KatalogEintrag? =
        eintraege.firstOrNull { it.paket.isNotBlank() && it.paket == paket }

    /**
     * Rät anhand des Buchungstexts vom Kontoauszug, welcher Dienst gemeint ist.
     * Vergleich in Kleinschreibung, längster Treffer gewinnt (damit "amazon music"
     * nicht von "amazon prime" verdrängt wird).
     */
    fun zuBuchungstext(text: String): KatalogEintrag? {
        val t = text.lowercase()
        var best: KatalogEintrag? = null
        var bestLen = 0
        for (e in eintraege) {
            for (b in e.buchung) {
                if (b.length > bestLen && t.contains(b)) {
                    best = e; bestLen = b.length
                }
            }
        }
        return best
    }
}
