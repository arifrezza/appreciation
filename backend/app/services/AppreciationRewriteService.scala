package services

import play.api.libs.ws._
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}
import play.api.libs.json._
import play.api.Logging

@Singleton
class AppreciationRewriteService @Inject()(
																						ws: WSClient
																					)(implicit ec: ExecutionContext) extends Logging {

	private val openAiUrl = "https://api.openai.com/v1/chat/completions"

	private val apiKey: String =
		sys.env.getOrElse(
			"OPENAI_API_KEY",
			throw new RuntimeException("OPENAI_API_KEY not set")
		)

	// Rewrite-specific prompt
	private val systemPrompt: String =
		"""You improve employee appreciation messages.

Rules:
- Preserve original meaning and tone.
- Keep user wording whenever possible.
- Improve clarity, professionalism, and structure.
- Do NOT invent fake details.
- Keep concise.
- Return ONLY rewritten text (no explanation)."""

	def rewrite(text: String): Future[Either[String, String]] = {

		val body = Json.obj(
			"model" -> "gpt-4o-mini",
			"messages" -> Json.arr(
				Json.obj("role" -> "system", "content" -> systemPrompt),
				Json.obj("role" -> "user", "content" -> text)
			),
			"temperature" -> 0.3,
			"max_tokens" -> 400
		)

		ws.url(openAiUrl)
			.addHttpHeaders(
				"Authorization" -> s"Bearer $apiKey",
				"Content-Type" -> "application/json"
			)
			.post(body)
			.map { response =>

				if (response.status == 200) {
					val content =
						(response.json \ "choices")(0) \ "message" \ "content"

					content.asOpt[String] match {
						case Some(text) => Right(text.trim)
						case None       => Left("No rewrite returned")
					}

				} else {
					logger.error(s"Rewrite API error: ${response.status}")
					Left("OpenAI API failed")
				}
			}
			.recover {
				case ex =>
					logger.error("Rewrite failed", ex)
					Left(ex.getMessage)
			}
	}
}
