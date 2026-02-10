package services

import javax.inject._
import scala.io.Source

@Singleton
class SlangFilterService {

	// 🔥 Loaded ONCE at application startup
	private val abusiveWords: Set[String] =
		Source.fromFile("conf/abusive_word_list.txt")
			.getLines()
			.map(_.trim.toLowerCase)
			.filter(_.nonEmpty)
			.toSet

	def containsAbusiveWord(text: String): Boolean = {
		val tokens = text.toLowerCase.split("\\W+")
		tokens.exists(abusiveWords.contains)
	}
}
