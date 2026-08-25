import { NextFunction, Response } from 'express';
import { RequestWithUser } from '@interfaces/auth.interface';
import dingModel from '@models/ding.model';
import { isUserZeltMiddelware } from '@middlewares/auth.middleware';
import { SCHLUESSEL_MAX, schluesselService } from '@services/schluessel.service';

class SchluesselController {
  /**
   * Mints the tent's read key - the one pasted into an export script or a
   * spreadsheet. Owner only, and the token is in this response and nowhere else:
   * only its hash is stored, so a lost key is reissued rather than looked up.
   * Minting again rotates, and the previous token stops working as this returns.
   */
  public postZugangsschluessel = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      if (!(await isUserZeltMiddelware(req, res, req.params.zelt_id))) {
        return;
      }
      res.status(200).json(await schluesselService.minteZugangsschluessel(req.params.zelt_id));
    } catch (error) {
      next(error);
    }
  };

  /**
   * Mints a club write key for one person in this tent. The `mensch` has to
   * exist here first, because the key writes as them: `akteur` comes from this
   * binding and never from a request body, which is what stops the shared tent
   * phone attributing Anna's pour to Ben.
   */
  public postSchluessel = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      if (!(await isUserZeltMiddelware(req, res, req.params.zelt_id))) {
        return;
      }

      const mensch_ding_id = typeof req.body?.mensch_ding_id === 'string' ? req.body.mensch_ding_id : '';
      if (!mensch_ding_id || !(await dingModel.exists({ ding_id: mensch_ding_id, zelt_id: req.params.zelt_id, art: 'mensch' }))) {
        res.status(400).json({ message: 'mensch_ding_id must be the ding_id of a mensch in this Zelt' });
        return;
      }

      if ((await schluesselService.lebendeSchluessel(req.params.zelt_id)) >= SCHLUESSEL_MAX) {
        res.status(409).json({ message: `this Zelt already has ${SCHLUESSEL_MAX} live Schlüssel - revoke one before minting another` });
        return;
      }

      res.status(200).json(await schluesselService.minteSchluessel(req.params.zelt_id, mensch_ding_id));
    } catch (error) {
      next(error);
    }
  };

  /**
   * What keys exist and for whom, so a lost phone can be answered from the
   * webapp rather than from a mongo shell. Never a token and never a hash: a
   * key is shown once, and a listing that could show it again would make
   * "shown once" a description of the UI instead of of the system.
   */
  public getSchluessel = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      if (!(await isUserZeltMiddelware(req, res, req.params.zelt_id))) {
        return;
      }
      res.status(200).json({ schluessel: await schluesselService.schluesselDesZelts(req.params.zelt_id) });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Revokes one club key (§15.3). Guarded on the tent the *key* names, because
   * a `schluessel_id` names no tent by itself - and an id that resolves to
   * nothing is refused rather than reported missing, so this answers a guess
   * with exactly what it answers a stranger's key with.
   */
  public deleteSchluessel = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const schluessel = await schluesselService.findeSchluessel(req.params.schluessel_id);
      if (!(await isUserZeltMiddelware(req, res, schluessel?.zelt_id ?? ''))) {
        return;
      }

      res.status(200).json({
        schluessel_id: schluessel.schluessel_id,
        widerrufen_at: await schluesselService.widerrufeSchluessel(schluessel.schluessel_id),
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * The read key's off switch. Rotation is not one: it always leaves a working
   * key behind, and an owner who pasted theirs into the wrong window wants the
   * tent to have none.
   */
  public deleteZugangsschluessel = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      if (!(await isUserZeltMiddelware(req, res, req.params.zelt_id))) {
        return;
      }
      res.status(200).json({ geloescht: await schluesselService.loescheZugangsschluessel(req.params.zelt_id) });
    } catch (error) {
      next(error);
    }
  };
}

export default SchluesselController;
