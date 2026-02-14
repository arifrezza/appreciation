package services

import play.api.libs.ws._
import javax.inject._
import scala.concurrent.ExecutionContext
import play.api.Logging
import play.api.libs.json._
import scala.concurrent.Future

case class CriterionResult(score: Int, pass: Boolean)
object CriterionResult {
  implicit val format: Format[CriterionResult] = Json.format[CriterionResult]
}

case class QualityResult(
  beSpecific: CriterionResult,
  highlightImpact: CriterionResult,
  acknowledgeEffort: CriterionResult,
  reinforceConsistency: CriterionResult,
  overallScore: Int,
  guidanceType: String,
  guidance: String
)
object QualityResult {
  implicit val format: Format[QualityResult] = Json.format[QualityResult]
}

@Singleton
class AppreciationQualityService @Inject()(
  ws: WSClient
)(implicit ec: ExecutionContext) extends Logging {

  private val openAiUrl = "https://api.openai.com/v1/chat/completions"
  private val apiKey: String =
    sys.env.getOrElse(
      "OPENAI_API_KEY",
      throw new RuntimeException("OPENAI_API_KEY environment variable not set")
    )

  private val systemPrompt: String =
    """You are an appreciation writing coach. Analyze the given appreciation message and:

IMPORTANT: Be STRICT in your evaluation. A message needs to CLEARLY and EXPLICITLY address each criterion to pass. Adding punctuation or making minor edits does NOT satisfy a criterion.

1. Score each criterion (0-100):
   - beSpecific: Does it mention specific actions, tasks, or achievements? (e.g., "finished the project", "completed the report", "fixed the bug")
   - highlightImpact: Does it explain the impact on the team, project, or company? (e.g., "which helped us meet the deadline", "which improved performance", "which saved the team time")
   - acknowledgeEffort: Does it recognize the effort, dedication, or hard work put in? (e.g., "your hard work", "your dedication", "going above and beyond")
   - reinforceConsistency: Does it encourage continued behavior or express hope for future contributions? (e.g., "keep it up", "looking forward to more", "continue the great work")

2. A criterion passes (pass: true) if score >= 50

3. Calculate overall score (average of all four criteria)

4. Based on the overall score, provide guidance:
   - If overallScore < 50: Set guidanceType to "question" and provide a brief coaching tip for ONLY THE SINGLE WEAKEST criterion (the one with the lowest score). 
     IMPORTANT: Give guidance for ONLY ONE criterion, not multiple. Pick the weakest one.
     Format: "[short tip text] Try using words like: [word1], [word2], [word3], [word4]"
     Examples (pick ONE based on weakest criterion):
     - For beSpecific: "What specific task did they help with? Try using words like: project, deadline, deliverable, milestone"
     - For highlightImpact: "How did this help the team? Try using words like: saved time, improved, enabled, accelerated"
     - For acknowledgeEffort: "Recognize their hard work! Try using words like: dedication, commitment, extra effort, went above"
     - For reinforceConsistency: "Encourage them to keep it up! Try using words like: keep up, looking forward, continue, always"
     NEVER combine tips for multiple criteria. ONLY address the single weakest one.
   - If overallScore >= 50: Set guidanceType to "suggestion" and provide a COMPLETELY REWRITTEN appreciation message. DO NOT just add text to the end of their message. Instead, REWRITE the entire message from scratch while keeping the core meaning. The rewritten message MUST:
     * Transform their basic message into a comprehensive appreciation that addresses ALL 4 criteria
     * Be SPECIFIC about what they did (mention concrete actions/tasks)
     * Explain the IMPACT of their work (how it helped the team/project/company)
     * ACKNOWLEDGE their effort, dedication, or hard work explicitly
     * ENCOURAGE them to continue (express hope for future contributions)
     * Sound natural and professional
     
     Example transformation:
     Original: "thank you for your help in the project"
     GOOD Rewrite: "Thank you for your dedicated work on the quarterly report project. Your attention to detail and thorough analysis helped us deliver high-quality insights to the leadership team ahead of schedule. I really appreciate the extra hours you put in during the final week. Your commitment to excellence is invaluable, and I look forward to collaborating with you on future projects."
     
     BAD Rewrite: "thank you for your help in the project. Your dedication was great and I hope you continue."
     
     The rewrite should be 2-4 sentences and naturally integrate all four criteria.

Respond ONLY with valid JSON in this exact format (no markdown, no explanation):
{
  "beSpecific": { "score": 0, "pass": false },
  "highlightImpact": { "score": 0, "pass": false },
  "acknowledgeEffort": { "score": 0, "pass": false },
  "reinforceConsistency": { "score": 0, "pass": false },
  "overallScore": 0,
  "guidanceType": "question",
  "guidance": "your contextual tip with word suggestions here"
}"""

  def checkQuality(text: String): Future[Either[String, QualityResult]] = {
    logger.info("Calling OpenAI Chat API for quality check")

    val requestBody = Json.obj(
      "model" -> "gpt-4o-mini",
      "messages" -> Json.arr(
        Json.obj(
          "role" -> "system",
          "content" -> systemPrompt
        ),
        Json.obj(
          "role" -> "user",
          "content" -> s"Analyze this appreciation message:\n\n$text"
        )
      ),
      "temperature" -> 0.7,
      "max_tokens" -> 500
    )

    ws.url(openAiUrl)
      .addHttpHeaders(
        "Authorization" -> s"Bearer $apiKey",
        "Content-Type" -> "application/json"
      )
      .post(requestBody)
      .map { response =>
        //logger.debug(s"OpenAI response status: ${response.status}")
        
        if (response.status == 200) {
          val json = response.json
          val content = (json \ "choices")(0) \ "message" \ "content"
          
          content.asOpt[String] match {
            case Some(jsonStr) =>
              // Clean up potential markdown formatting
              val cleanJson = jsonStr
                .replaceAll("```json\\s*", "")
                .replaceAll("```\\s*", "")
                .trim
              
              Json.parse(cleanJson).validate[QualityResult] match {
                case JsSuccess(result, _) => 
                  logger.info(s"Quality check complete: score=${result.overallScore}, type=${result.guidanceType}")
                  Right(result)
                case JsError(errors) => 
                  logger.error(s"JSON parse error: $errors")
                  Left(s"Failed to parse AI response: $errors")
              }
            case None => 
              Left("No content in AI response")
          }
        } else {
          logger.error(s"OpenAI API error: ${response.status} - ${response.body}")
          Left(s"OpenAI API error: ${response.status}")
        }
      }
      .recover {
        case ex: Exception =>
          logger.error("OpenAI API call failed", ex)
          Left(s"API call failed: ${ex.getMessage}")
      }
  }
}
