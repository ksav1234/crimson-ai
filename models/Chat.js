const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');

const Chat = sequelize.define('Chat', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    }
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'New Conversation'
  },
  messages: {
    type: DataTypes.TEXT('long'),
    allowNull: false,
    defaultValue: '[]',
    get() {
      const rawValue = this.getDataValue('messages');
      return rawValue ? JSON.parse(rawValue) : [];
    },
    set(value) {
      this.setDataValue('messages', JSON.stringify(value));
    }
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'chats',
  timestamps: true
});

// Define relationships
User.hasMany(Chat, { foreignKey: 'userId', as: 'chats' });
Chat.belongsTo(User, { foreignKey: 'userId', as: 'user' });

module.exports = Chat;