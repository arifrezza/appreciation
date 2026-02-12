package services

import javax.inject._
import play.api.Environment
import scala.io.Source
import scala.util.matching.Regex
import play.api.Logging

// TO CHECK LOCAL ABUSIVE WORDS FROM FILE
@Singleton
class AbusiveWordsService @Inject()(env: Environment) extends Logging {

	/**
	 * Phonetic + obfuscation map
	 * Allows sound-alike detection
	 */
	private val phoneticMap: Map[Char, String] = Map(
		// 🔥 VOWELS (phonetic equivalents)
		'a' -> "[a@]+",
		'i' -> "[i1!y]+",
		'e' -> "[e3]+",
		'o' -> "[o0u]+",     // o ↔ u
		'u' -> "[u0o]+",     // u ↔ o
		'y' -> "[y]*",

		// 🔥 Silent / optional
		'h' -> "[h]*",

		// 🔥 CONSONANTS
		'k' -> "[kq]+",
		'c' -> "[csk]+",
		's' -> "[sz]+",
		't' -> "[t]+",
		'd' -> "[d]+",
		'r' -> "[r]+",
		'l' -> "[l]+",
		'g' -> "[g]+",
		'n' -> "[n]+",
		'm' -> "[m]+",
		'b' -> "[b]+",
		'p' -> "[p]+",
		'f' -> "[f]+",
		'x' -> "[xks]+"
	)

	/**
	 * Normalize text to handle common evasion tricks
	 * IMPORTANT: used for BOTH input text AND abusive list
	 */
	/*private def normalizeText(text: String): String = {
		text
			.toLowerCase
			// 🔥 fuck → fuk
			.replaceAll("ck", "k")
			// 🔥 collapse repeated letters: fuuuck → fuk
			.replaceAll("(.)\\1+", "$1")
	}*/

	// New at home
	private def normalizeText(text: String): String = {
		text
			.toLowerCase
			// 🔥 handle masked fuck: f*k, f**k, f__k → fuk
			.replaceAll("f\\W*k", "fuk")
			// 🔥 fuck → fuk
			.replaceAll("ck", "k")
			// 🔥 collapse repeated letters
			.replaceAll("(.)\\1+", "$1")
	}


	private def compactLetters(text: String): String = {
		text.replaceAll("[^a-zA-Z]", "").toLowerCase
	}



	/**
	 * Load abusive words from file
	 */
	private val abusiveWords: Seq[String] = {
		logger.debug(s"ABUSIVE_WORD_LIST loaded into Memory")
		val file = env.getFile("conf/abusive_word_list.txt")
		Source.fromFile(file)
			.getLines()
			.map(_.trim.toLowerCase)
			.filter(_.nonEmpty)
			.toSeq
	}

	/**
	 * Compile regex patterns ONCE at startup
	 * 🔥 IMPORTANT: abusive words are normalized BEFORE regex build
	 */
	private val abusivePatterns: Seq[Regex] =
		abusiveWords
			.map(normalizeText)
			.map(buildPhoneticRegex)

	/**
	 * Build phonetic + flexible regex for a word
	 */
	private def buildPhoneticRegex(word: String): Regex = {
		val pattern =
			word
				.map { ch =>
					phoneticMap.getOrElse(ch, s"$ch+")
				}
				.mkString("[^a-zA-Z0-9]*")

		pattern.r
	}

	/**
	 * Public API used by controller
	 */
	def containsAbusiveWord(text: String): Boolean = {
		logger.info("ABUSE CHECK TRIGGERED (user stopped typing)")
		val normalized = normalizeText(text)
		val compactNormalized =
			normalizeText(compactLetters(text))

		abusivePatterns.exists { pattern =>
			pattern.findFirstIn(normalized).isDefined ||
				pattern.findFirstIn(compactNormalized).isDefined
		}
	}




}
