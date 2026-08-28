import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { hash } from 'bcrypt';
import { Document, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { HttpException } from '@common/http-exception';
import { User } from '@fg2/shared-types';
import { isEmpty } from '@utils/util';
import { logger } from '@utils/logger';
import { authConfig } from '../../config/configuration';
import { MODEL } from '../../database/models.module';

// A password hash has no business leaving the server, whoever is asking.
const WITHOUT_PASSWORD = { password: 0 };

export interface UserPayload {
  username?: string;
  password?: string;
  is_admin?: boolean;
}

@Injectable()
export class UserService implements OnModuleInit {
  constructor(
    @InjectModel(MODEL.user) private readonly users: Model<User & Document>,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  /**
   * The account named by the environment is created on first start and has its
   * password reset to the configured one on every start, so an operator who has
   * lost it only has to change the setting and restart.
   */
  public async onModuleInit(): Promise<void> {
    const { adminUsername, adminPassword } = this.config;

    try {
      const hashedPassword = await hash(adminPassword, 10);
      const existing = await this.users.findOne({ username: adminUsername });

      if (existing) {
        await this.users.findOneAndUpdate({ username: adminUsername }, { password: hashedPassword, is_admin: true, is_active: true });
        return;
      }

      logger.info(`Creating the configured admin account ${adminUsername}`);
      await this.users.create({
        username: adminUsername,
        password: hashedPassword,
        is_admin: true,
        is_active: true,
        user_id: '5b96fd82-4092-4542-a9a2-bceb7df852dd',
      });
    } catch (error) {
      // Not fatal: the rest of the API still works, and the readiness probe
      // reports the account as missing until this succeeds.
      logger.error(`Could not bootstrap the admin account: ${String(error)}`);
    }
  }

  public findAllUser(): Promise<User[]> {
    return this.users.find({}, { _id: 0, username: 1, user_id: 1, is_admin: 1 }).then(users => users as unknown as User[]);
  }

  public async findUserById(userId: string): Promise<User> {
    if (isEmpty(userId)) throw new HttpException(400, "You're not userId");

    const findUser = await this.users.findOne({ _id: userId }, WITHOUT_PASSWORD);
    if (!findUser) throw new HttpException(409, "You're not user");

    return findUser as unknown as User;
  }

  public async createUser(userData: UserPayload): Promise<User> {
    if (isEmpty(userData)) throw new HttpException(400, "You're not userData");

    const findUser = await this.users.findOne({ username: userData.username });
    if (findUser) throw new HttpException(409, `You're username ${userData.username} already exists`);

    const hashedPassword = await hash(userData.password, 10);
    const created = await this.users.create({ ...userData, password: hashedPassword, user_id: uuidv4() });

    const { password: _hash, ...safe } = created.toObject();
    return safe as unknown as User;
  }

  public async updateUser(userId: string, userData: UserPayload): Promise<User> {
    if (isEmpty(userData)) throw new HttpException(400, "You're not userData");

    if (userData.username) {
      // The route addresses a user by its database id, which is what the
      // candidate has to be compared against to let a user keep its own name.
      const findUser = await this.users.findOne({ username: userData.username });
      if (findUser && String(findUser._id) !== String(userId)) throw new HttpException(409, `You're username ${userData.username} already exists`);
    }

    if (userData.password) {
      userData = { ...userData, password: await hash(userData.password, 10) };
    }

    const updated = await this.users.findByIdAndUpdate(userId, userData, { new: true, projection: WITHOUT_PASSWORD });
    if (!updated) throw new HttpException(409, "You're not user");

    return updated as unknown as User;
  }

  public async deleteUser(userId: string): Promise<User> {
    const deleted = await this.users.findByIdAndDelete(userId, { projection: WITHOUT_PASSWORD });
    if (!deleted) throw new HttpException(409, "You're not user");

    return deleted as unknown as User;
  }
}

export default UserService;
