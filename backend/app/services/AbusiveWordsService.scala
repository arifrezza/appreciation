package services

import javax.inject._
import play.api.Environment
import scala.io.Source
import scala.util.matching.Regex
import play.api.Logging

@Singleton
class AbusiveWordsService @Inject()(env: Environment) extends Logging {

	/* ============================
		 Load abusive words
	============================ */

	private val abusiveWords: Seq[String] = {
		logger.debug("ABUSIVE WORD LIST LOADED")
		val file = env.getFile("conf/abusive_word_list.txt")

		Source.fromFile(file)
			.getLines()
			.map(_.trim.toLowerCase)
			.filter(_.nonEmpty)
			.toSeq
	}

	/* ============================
		 Safe Regex Builder
		 - Full word match only
		 - Optional masked characters allowed
	============================ */

	private def buildSafeRegex(word: String): Regex = {

		val maskedPattern =
			word
				.toCharArray
				.map(ch => s"$ch+[\\W_]*")
				.mkString

		val fullPattern = s"\\b$maskedPattern\\b"

		fullPattern.r
	}


	/* ============================
		 Compile patterns once
	============================ */

	private val abusivePatterns: Seq[Regex] =
		abusiveWords.map(buildSafeRegex)

	/* ============================
		 Public API
	============================ */

	def containsAbusiveWord(text: String): Boolean = {

		logger.info("ABUSE CHECK TRIGGERED")

		val lowerText = text.toLowerCase

		abusivePatterns.exists { pattern =>
			pattern.findFirstIn(lowerText).isDefined
		}
	}
}
