package com.volme3d.v3dabos

import java.time.LocalDate

/** Absenderdaten für das Kündigungsschreiben, einmalig in den Einstellungen hinterlegt. */
data class Absender(
    val name: String = "",
    val strasse: String = "",
    val ort: String = "",
    val email: String = ""
) {
    val leer: Boolean get() = name.isBlank()
}

/**
 * Erzeugt ein Kündigungsschreiben in Textform (§ 126b BGB). Bewusst ohne Datum des
 * gewünschten Vertragsendes: "zum nächstmöglichen Zeitpunkt" ist rechtlich sicherer,
 * als sich auf einen Termin festzulegen, der falsch berechnet sein könnte.
 */
object Kuendigung {

    fun betreff(abo: Abo): String {
        val nr = listOfNotNull(
            abo.kundennummer.ifBlank { null }?.let { "Kundennummer $it" },
            abo.vertragsnummer.ifBlank { null }?.let { "Vertragsnummer $it" }
        ).joinToString(", ")
        return "Kündigung ${abo.name}" + if (nr.isNotBlank()) " – $nr" else ""
    }

    fun text(abo: Abo, absender: Absender, heute: LocalDate): String {
        val sb = StringBuilder()
        if (!absender.leer) {
            sb.append(absender.name).append('\n')
            if (absender.strasse.isNotBlank()) sb.append(absender.strasse).append('\n')
            if (absender.ort.isNotBlank()) sb.append(absender.ort).append('\n')
            if (absender.email.isNotBlank()) sb.append(absender.email).append('\n')
            sb.append('\n')
        }
        if (abo.anbieter.isNotBlank()) sb.append("An: ").append(abo.anbieter).append("\n\n")
        sb.append(Fmt.datum(heute)).append("\n\n")
        sb.append(betreff(abo)).append("\n\n")
        sb.append("Sehr geehrte Damen und Herren,\n\n")
        sb.append("hiermit kündige ich meinen Vertrag „").append(abo.name).append("“")
        val kennung = listOfNotNull(
            abo.kundennummer.ifBlank { null }?.let { "Kundennummer: $it" },
            abo.vertragsnummer.ifBlank { null }?.let { "Vertragsnummer: $it" }
        ).joinToString(", ")
        if (kennung.isNotBlank()) sb.append(" (").append(kennung).append(")")
        sb.append(" ordentlich zum nächstmöglichen Zeitpunkt.\n\n")
        sb.append("Einer stillschweigenden Verlängerung des Vertrags widerspreche ich ausdrücklich.\n\n")
        sb.append("Bitte bestätigen Sie mir den Eingang dieser Kündigung und das Datum des ")
        sb.append("Vertragsendes in Textform. Etwaige Einzugsermächtigungen bitte ich zum ")
        sb.append("Vertragsende zu löschen; noch offene Guthaben überweisen Sie bitte auf ")
        sb.append("mein bekanntes Konto.\n\n")
        sb.append("Mit freundlichen Grüßen\n\n")
        sb.append(absender.name.ifBlank { "" })
        return sb.toString()
    }

    /**
     * Deep-Link in die Play-Abo-Verwaltung. Mit Paket und SKU landet man direkt beim Abo,
     * ohne beim Übersichtsbildschirm.
     */
    fun playUrl(abo: Abo): String {
        val basis = "https://play.google.com/store/account/subscriptions"
        val paket = abo.playPaket.ifBlank { abo.appPaket }
        return when {
            abo.playSku.isNotBlank() && paket.isNotBlank() -> "$basis?sku=${abo.playSku}&package=$paket"
            paket.isNotBlank() -> "$basis?package=$paket"
            else -> basis
        }
    }
}
