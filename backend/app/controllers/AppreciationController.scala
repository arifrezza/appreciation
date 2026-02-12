package controllers

import javax.inject.Inject
import play.api.mvc._
import play.api.libs.json._
import services.SlangFilterService

/**
 * AppreciationController - Handles appreciation submissions
 * 
 * FLOW: Request → Extract message → Check for abuse → Return response
 */
class AppreciationController @Inject()(
  cc: ControllerComponents,
  slangFilter: SlangFilterService
) extends AbstractController(cc) {

  /**
   * POST /api/appreciation
   * Body: { "message": "Your appreciation text" }
   */
  def submitAppreciation(): Action[JsValue] = Action(parse.json) { request =>
    // STEP 1: Extract the "message" field from JSON body
    val message: String = (request.body \ "message").as[String]
    
    // STEP 2: Check if message contains abusive words
    val hasAbusiveContent: Boolean = slangFilter.containsAbusiveWord(message)
    
    // STEP 3: Return response based on check result
    if (hasAbusiveContent) {
      BadRequest("Abusive language detected")
    } else {
      Ok("Appreciation saved")
    }
  }
}

