import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { compare, hash } from 'bcrypt';
import { sign } from 'jsonwebtoken';
import { timingSafeEqual } from 'node:crypto';
import { Document, Model } from 'mongoose';
import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';
import { ActivationDto, LoginDto, SignupDto } from '@modules/auth/auth.types';
import { HttpException } from '@common/http-exception';
import { DataStoredInToken, TokenData } from '@common/auth/auth.interface';
import { PasswordToken, User } from '@fg2/shared-types';
import { isEmpty } from '@utils/util';
import { DEMO_USER_ID } from '@utils/demo';
import { appConfig, authConfig } from '../../config/configuration';
import { MODEL } from '../../database/models.module';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(MODEL.user) private readonly users: Model<User & Document>,
    @InjectModel(MODEL.passwordToken) private readonly passwordTokens: Model<PasswordToken & Document>,
    private readonly mail: MailService,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  public async signup(userData: SignupDto): Promise<User> {
    if (isEmpty(userData)) throw new HttpException(400, 'Invalid request data.');

    const findUser = await this.users.findOne({ username: userData.username });
    if (findUser) throw new HttpException(409, 'User allready exists');

    const hashedPassword = await hash(userData.password, 10);
    if (this.auth.requireActivation) {
      const activation_code = uuidv4();
      const createUserData = await this.users.create({
        ...userData,
        password: hashedPassword,
        is_active: false,
        activation_code: activation_code,
        user_id: uuidv4(),
      });

      await this.mail.send({
        to: userData.username,
        subject: 'Please activate your Plantalytix account',
        text: `Activation url: ${this.app.apiUrlExternal}/login?code=${activation_code}`,
      });

      return createUserData as unknown as User;
    } else {
      const activation_code = uuidv4();
      const createUserData = await this.users.create({
        ...userData,
        password: hashedPassword,
        is_active: true,
        activation_code: activation_code,
        user_id: uuidv4(),
      });
      return createUserData as unknown as User;
    }
  }

  public async generatePasswordToken(username: string): Promise<void> {
    const findUser = await this.users.findOne({ username: username });
    if (!findUser) throw new HttpException(409, 'Invalid user');

    const token = uuidv4();
    await this.passwordTokens.create({ token: token, user_id: findUser.user_id });
    await this.mail.send({
      to: username,
      subject: 'Reset your Plantalytix password',
      text: `Change password: ${this.app.apiUrlExternal}/login?recovery=${token}`,
    });
  }

  public async activate(userData: ActivationDto): Promise<boolean> {
    if (isEmpty(userData)) throw new HttpException(400, 'Invalid request data.');

    const findUser = await this.users.findOne({ activation_code: userData.activation_code });
    if (!findUser) throw new HttpException(409, 'Wrong activation code');

    await this.users.findOneAndUpdate({ activation_code: userData.activation_code }, { is_active: true });
    return true;
  }

  public async login(userData: LoginDto): Promise<{ userToken: TokenData; refreshToken: TokenData; imageToken: TokenData; findUser: User }> {
    if (isEmpty(userData)) throw new HttpException(400, 'Invalid request data.');

    const findUser = await this.users.findOne(
      { username: userData.username },
      { _id: 0, username: 1, user_id: 1, is_admin: 1, password: 1, is_active: 1 },
    );
    if (!findUser) throw new HttpException(409, 'Wrong email/password');

    const isPasswordMatching: boolean = await compare(userData.password, findUser.password);
    if (!isPasswordMatching) throw new HttpException(409, 'Wrong email/password');

    if (!findUser.is_active) throw new HttpException(409, 'User not activated');

    const { userToken, refreshToken, imageToken } = this.createTokensFromUser(findUser, userData.stayLoggedIn);

    return { userToken, refreshToken, findUser: findUser as unknown as User, imageToken };
  }

  // Anyone may open the demo: it is a session without an account that reaches
  // nothing but the devices explicitly flagged as demo devices, and may not write.
  public demoLogin(): { userToken: TokenData; refreshToken: TokenData; imageToken: TokenData } {
    return this.createTokens({ user_id: DEMO_USER_ID, is_admin: false, is_demo: true });
  }

  public async changePassword(user_id: string, password: string): Promise<void> {
    const findUser = await this.users.findOne({ user_id: user_id }, { _id: 0, username: 1, user_id: 1, is_admin: 1, password: 1, is_active: 1 });
    if (!findUser) throw new HttpException(409, 'Wrong email/password');
    const hashedPassword = await hash(password, 10);

    await this.users.findOneAndUpdate({ user_id: user_id }, { password: hashedPassword });
  }

  public async changePasswordWithToken(token: string, password: string): Promise<void> {
    const pwtoken = await this.passwordTokens.findOne({
      token: token,
      createdAt: { $gt: DateTime.now().minus({ days: 1 }).toISODate() },
    });
    if (!pwtoken) throw new HttpException(409, 'Wrong token');
    const hashedPassword = await hash(password, 10);
    await this.users.findOneAndUpdate({ user_id: pwtoken.user_id }, { password: hashedPassword });
  }

  public async loginWithToken(token: string): Promise<{ userToken: TokenData }> {
    const expected = this.auth.automationToken;
    if (!expected) {
      throw new HttpException(401, 'Wrong authentication token');
    }

    const supplied = typeof token === 'string' ? token : '';
    const len = Math.max(expected.length, supplied.length, 32);
    const a = Buffer.alloc(len);
    const b = Buffer.alloc(len);
    a.write(supplied, 0, 'utf8');
    b.write(expected, 0, 'utf8');
    if (!timingSafeEqual(a, b) || supplied.length !== expected.length) {
      throw new HttpException(401, 'Wrong authentication token');
    }

    const dataStoredInToken: DataStoredInToken = {
      user_id: '',
      is_admin: true,
      token_type: 'user',
      secret: uuidv4(),
    };

    const token_expiration: number = 5 * 60;

    return {
      userToken: {
        expiresIn: token_expiration,
        token: sign(dataStoredInToken, this.auth.secretKey, { expiresIn: token_expiration }),
        secret: dataStoredInToken.secret,
      },
    };
  }

  public async refresh(tokenData: DataStoredInToken): Promise<{ userToken: TokenData; refreshToken: TokenData; imageToken: TokenData }> {
    const { userToken, refreshToken, imageToken } = this.createTokens({
      user_id: tokenData.user_id,
      is_admin: tokenData.is_admin,
      stay_logged_in: tokenData.stay_logged_in,
      is_demo: tokenData.is_demo,
    });
    return { userToken, refreshToken, imageToken };
  }

  public async logout(userData: User): Promise<User> {
    if (isEmpty(userData)) throw new HttpException(400, "You're not userData");

    const findUser = await this.users.findOne({ username: userData.username, password: userData.password });
    if (!findUser) throw new HttpException(409, `You're username ${userData.username} not found`);

    return findUser as unknown as User;
  }

  public createTokensFromUser(user: User, stayLoggedIn: boolean): { userToken: TokenData; refreshToken: TokenData; imageToken: TokenData } {
    return this.createTokens({
      user_id: user.user_id,
      is_admin: user.is_admin,
      stay_logged_in: stayLoggedIn,
    });
  }

  public createTokens(dataStoredInToken: Omit<DataStoredInToken, 'token_type' | 'secret'>): {
    userToken: TokenData;
    refreshToken: TokenData;
    imageToken: TokenData;
  } {
    const token_expiration: number = 5 * 60;
    const refresh_expiration: number = (dataStoredInToken.stay_logged_in ? 30 * 24 * 60 : 30) * 60;
    const image_expiration: number = 30 * 24 * 60 * 60;
    const secret = Math.random().toString(36).substring(2, 15);

    return {
      userToken: {
        expiresIn: token_expiration,
        token: sign({ ...dataStoredInToken, secret, token_type: 'user' }, this.auth.secretKey, { expiresIn: token_expiration }),
        secret,
      },
      refreshToken: {
        expiresIn: refresh_expiration,
        token: sign({ ...dataStoredInToken, secret, token_type: 'refresh' }, this.auth.secretKey, { expiresIn: refresh_expiration }),
        secret,
      },
      imageToken: {
        expiresIn: image_expiration,
        token: sign({ ...dataStoredInToken, secret, token_type: 'image' }, this.auth.secretKey, { expiresIn: image_expiration }),
        secret,
      },
    };
  }
}

export default AuthService;
