package controllers

import javax.inject._
import play.api.mvc._

@Singleton
class HomeController @Inject()(
  cc: ControllerComponents
) extends AbstractController(cc) {

  /**
   * Serves the Angular application entry point
   * GET /
   */
  def index: Action[AnyContent] = Action { implicit request =>
    Ok(views.html.index())
  }
}
