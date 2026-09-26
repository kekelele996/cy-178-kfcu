const db = require('../data/database');
const LetterModel = require('../models/letterModel');
const UserModel = require('../models/userModel');
const FavoriteModel = require('../models/favoriteModel');
const { LETTER_STATUS, LETTER_KIND, MESSAGES } = require('../config/constants');

const LetterService = {
  sendRandom({ senderId, content }) {
    const other = UserModel.findRandomOther(senderId);
    if (!other) {
      const err = new Error(MESSAGES.NO_OTHER_USERS);
      err.code = 'NO_USERS';
      throw err;
    }
    const id = LetterModel.create({
      senderId,
      receiverId: other.id,
      parentId: null,
      content,
      status: LETTER_STATUS.DELIVERED,
      createdAt: Date.now()
    });
    return LetterModel.findById(id);
  },

  reply({ userId, parentId, content }) {
    const parent = LetterModel.findById(parentId);
    if (!parent) {
      const err = new Error(MESSAGES.LETTER_NOT_FOUND);
      err.code = 'NOT_FOUND';
      throw err;
    }
    const isReceiver = parent.receiver_id === userId;
    const isSender = parent.sender_id === userId;
    if (!isReceiver && !isSender) {
      const err = new Error(MESSAGES.NOT_YOUR_LETTER);
      err.code = 'FORBIDDEN';
      throw err;
    }
    const receiverId = isReceiver ? parent.sender_id : parent.receiver_id;
    const rootId = LetterModel.findRootByChild(parent.id);

    // IMMEDIATE takes the write lock up front so that a farewell racing with
    // this reply is fully serialised: whoever commits first wins, the other
    // side sees the sealed flag and is rejected.
    const writeReply = db.transaction(() => {
      const root = LetterModel.findById(rootId);
      if (root.sealed) {
        const err = new Error(MESSAGES.THREAD_SEALED);
        err.code = 'SEALED';
        throw err;
      }
      const id = LetterModel.create({
        senderId: userId,
        receiverId,
        parentId: rootId,
        content,
        status: LETTER_STATUS.REPLIED,
        kind: LETTER_KIND.NORMAL,
        createdAt: Date.now()
      });
      if (parent.status === LETTER_STATUS.DELIVERED || parent.status === LETTER_STATUS.PENDING) {
        LetterModel.updateStatus(parent.id, LETTER_STATUS.REPLIED);
      }
      return id;
    });

    const id = writeReply.immediate();
    return LetterModel.findById(id);
  },

  farewell({ userId, rootId: rawRootId, content }) {
    const rootId = LetterModel.findRootByChild(rawRootId);
    const root = LetterModel.findById(rootId);
    if (!root) {
      const err = new Error(MESSAGES.LETTER_NOT_FOUND);
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (root.sender_id !== userId && root.receiver_id !== userId) {
      const err = new Error(MESSAGES.NOT_YOUR_LETTER);
      err.code = 'FORBIDDEN';
      throw err;
    }
    const receiverId = root.sender_id === userId ? root.receiver_id : root.sender_id;

    const writeFarewell = db.transaction(() => {
      const sealedAt = Date.now();
      const sealed = LetterModel.sealRoot(rootId, { userId, sealedAt });
      if (!sealed) {
        const err = new Error(MESSAGES.THREAD_SEALED);
        err.code = 'SEALED';
        throw err;
      }
      const id = LetterModel.create({
        senderId: userId,
        receiverId,
        parentId: rootId,
        content,
        status: LETTER_STATUS.REPLIED,
        kind: LETTER_KIND.FAREWELL,
        createdAt: sealedAt
      });
      return id;
    });

    const id = writeFarewell.immediate();
    return LetterModel.findById(id);
  },

  skip({ userId, letterId }) {
    const letter = LetterModel.findById(letterId);
    if (!letter) {
      const err = new Error(MESSAGES.LETTER_NOT_FOUND);
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (letter.receiver_id !== userId) {
      const err = new Error(MESSAGES.NOT_YOUR_LETTER);
      err.code = 'FORBIDDEN';
      throw err;
    }
    LetterModel.updateStatus(letterId, LETTER_STATUS.SKIPPED);
    return true;
  },

  toggleFavorite({ userId, letterId }) {
    const exists = FavoriteModel.exists({ userId, letterId });
    if (exists) {
      FavoriteModel.remove({ userId, letterId });
      return { favorited: false };
    }
    FavoriteModel.add({ userId, letterId, createdAt: Date.now() });
    return { favorited: true };
  },

  isFavorited({ userId, letterId }) {
    return FavoriteModel.exists({ userId, letterId });
  },

  listInbox(userId) {
    const rawSent = LetterModel.listSentByUser(userId);
    const rawReceived = LetterModel.listReceivedByUser(userId);
    const rawConvos = LetterModel.listConversationsForUser(userId);
    const favorites = new Set(
      FavoriteModel.listByUser(userId).map((l) => l.id)
    );
    const decorate = (list, role) =>
      list.map((l) => ({
        id: l.id,
        preview: l.content.slice(0, 80),
        status: l.status,
        sealed: !!l.sealed,
        sealedAt: l.sealed_at,
        createdAt: l.created_at,
        replyCount: l.reply_count,
        role,
        favorited: favorites.has(l.id)
      }));
    return {
      sent: decorate(rawSent, 'sent'),
      received: decorate(rawReceived, 'received'),
      conversations: decorate(rawConvos, 'either')
    };
  },

  getThread({ userId, rootId }) {
    const thread = LetterModel.listThread(rootId);
    if (!thread.length) {
      const err = new Error(MESSAGES.LETTER_NOT_FOUND);
      err.code = 'NOT_FOUND';
      throw err;
    }
    const first = thread[0];
    if (first.sender_id !== userId && first.receiver_id !== userId) {
      const err = new Error(MESSAGES.NOT_YOUR_LETTER);
      err.code = 'FORBIDDEN';
      throw err;
    }
    const me = userId;
    return {
      rootId,
      sealed: !!first.sealed,
      sealedByMe: first.sealed ? first.sealed_by === me : false,
      sealedAt: first.sealed_at,
      favorited: FavoriteModel.exists({ userId, letterId: rootId }),
      messages: thread.map((m) => ({
        id: m.id,
        content: m.content,
        createdAt: m.created_at,
        kind: m.kind || LETTER_KIND.NORMAL,
        fromMe: m.sender_id === me
      }))
    };
  }
};

module.exports = LetterService;
