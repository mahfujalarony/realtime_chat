module.exports = (sequelize, DataTypes) => {
  const GroupMember = sequelize.define(
    'GroupMember',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      groupId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM('admin', 'member'),
        allowNull: false,
        defaultValue: 'member',
      },
      lastReadAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'group_members',
      underscored: true,
      indexes: [
        { fields: ['group_id'] },
        { fields: ['user_id'] },
        { unique: true, fields: ['group_id', 'user_id'] },
      ],
    },
  )

  return GroupMember
}
