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

	private val criteriaDescriptions: Map[String, String] = Map(
		"Be specific" -> "Mention a concrete action, task, project, or achievement. Vague praise like 'great job' is not enough — name a specific deliverable, event, or task.",
		"Highlight impact" -> "Explain the effect on the team, project, timeline, or organization. Describe a consequence or outcome of what the person did.",
		"Acknowledge effort" -> "Recognize the effort, dedication, perseverance, or hard work involved. Reference the person's dedication, extra hours, or determination.",
		"Reinforce consistency" -> "Encourage continued behavior or express confidence in future contributions. Add a forward-looking phrase that encourages repetition of the good behavior."
	)

	private val basePrompt: String =
		"""You improve employee appreciation messages for a corporate recognition platform.

Rules:
- Preserve original meaning and tone.
- Keep user wording whenever possible.
- Do NOT invent fake details (projects, names, events) not in the original.
- Keep concise — only add what is needed.
- Use professional formal language.
- Return ONLY the rewritten text (no explanation, no quotes)."""

	private def buildPrompt(failingCriteria: Seq[String]): String = {
		if (failingCriteria.isEmpty) {
			basePrompt + "\n\nImprove clarity, professionalism, and structure."
		} else {
			val criteriaSection = failingCriteria.flatMap { name =>
				criteriaDescriptions.get(name).map(desc => s"- $name: $desc")
			}.mkString("\n")

			basePrompt +
				s"""
				   |
				   |The message currently FAILS the following quality criteria. You MUST specifically address each one by adding or enhancing relevant phrases:
				   |
				   |$criteriaSection
				   |
				   |Keep parts of the message that already satisfy passing criteria unchanged. Only modify or add what is needed for the failing criteria listed above.""".stripMargin
		}
	}

	def rewrite(text: String, failingCriteria: Seq[String]): Future[Either[String, String]] = {

		val prompt = buildPrompt(failingCriteria)

		val body = Json.obj(
			"model" -> "gpt-4o-mini",
			"messages" -> Json.arr(
				Json.obj("role" -> "system", "content" -> prompt),
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
